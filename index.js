import { WebSocketServer } from 'ws';
import { SmartBuffer } from 'smart-buffer';
import express from 'express';
import { createServer } from 'http';

import config from './config.js';

import { Token } from './Token.js';
import { minions, Minion, tokens } from './Minion.js';
import { CaptchaQueue, getCaptchaToken } from './CaptchaQueue.js';
import { getRandomNumber } from './util.js';
import {parse} from 'url';

export function getConfig() {
	return config;
}

const port = Number(process.env.PORT) || 6969;
console.log(port);

const app = express();

const API_ENDPOINT = 'https://discord.com/api/v10'
const CLIENT_ID = '1012740534684631163'
const CLIENT_SECRET = 'mTn0ng_0aJBO3QuJvZgwHg8txXokPhyk'
const REDIRECT_URI = 'https://axon-bots.herokuapp.com/callback';

app.get('/callback', (req, res) => {
	const {code} = req.query;
	if (!code) {
		res.status(500);
		return;
	}

	const params = new URLSearchParams({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        grant_type: 'authorization_code',
        redirect_uri: REDIRECT_URI,
        scope: 'identify',
        code: code
    });
    
    fetch(`${API_ENDPOINT}/oauth2/token`, {
        method: 'POST',
        body: params
    })
    .then(response => response.json())
    .then(data => {
        console.log(data);
        
        fetch('https://discordapp.com/api/users/@me', {
            method: 'GET',
            headers: {
                Authorization: `Bearer ${data.access_token}`
            }
        })
        .then(response => response.json())
        .then(profile => {
            const {username: name, id} = profile;

            const result = JSON.stringify({
                success: true,
                id,
                name
            });

            res.send(`<script>window.addEventListener('message',m=>m.data==='done'&&window.close());window.opener.postMessage(${result},'*');</script>`).end();
        })
        .catch(() => {
            res.json({ success: false }).end();
        });
    })
    .catch(() => {
        res.json({ success: false }).end();
    });
});

app.get('/login', (req, res) => {
    res.redirect(`https://discord.com/oauth2/authorize?response_type=code&client_id=${CLIENT_ID}&scope=identify&redirect_uri=${encodeURIComponent(REDIRECT_URI)}`);
});

app.head('/empty', (req, res) => {
	res.writeHead(200, {
		'Access-Control-Allow-Origin': '*'
	}).end();
});

app.get('/empty', (req, res) => {
	res.writeHead(200, {
		'Access-Control-Allow-Origin': '*'
	}).end();
});

const server = app.listen(port, () => console.log(`Listening on port ${port}`));

const wss = new WebSocketServer({ path: '/websocket', server: server, perMessageDeflate: false });

/** 
 * Storage for clients, ordered by their discord IDs
 * @type {Map<string, {socket:WebSocket;lobbyUrl:string,custom:{name:string?;tag:string?;skin:string?};movementEnabled:boolean;captchaQueue:CaptchaQueue}>} 
 **/
 export const clientMap = new Map()

const interval = setInterval(() => {
	/** @type {Array<Minion>} */
	const connected = [];
	/** @type {Array<Minion>} */
	const solving = [];
	/** @type {Array<Minion>} */
	const dead = [];
	/** @type {Array<Minion>} */
	const alive = [];
	/** @type {Array<Minion>} */
	const spectating = [];
	/** @type {Array<Minion>} */
	const reserved = [];
	/** @type {Array<Minion} */
	const frozen = [];

	[...minions.values()].forEach(m => {
		if (m.active && m.connected) {
			if (m.alive)
				alive.push(m);
			else if (m.spectating)
				spectating.push(m);
			else
				dead.push(m);
			
			if (m.reserved)
				reserved.push(m);

			if (m.frozen)
				frozen.push(m);

			connected.push(m);
		}
		else if (m.active && m.solvingCaptcha)
			solving.push(m);
	});
	
	const message = [];

	message.push(`Serving ${clientMap.size}`);	
	message.push(`Connected ${connected.length}`);
	message.push(`Solving ${solving.length}`);
	
	if (connected.length > 0 && connected.some(m => m.latency > 0)) {
		const latencies = connected.map(m=>m.latency).filter(x=>x>0);

		const average = Math.floor(latencies.reduce((a,v,i)=>(a*i+v)/(i+1)));
		if (average >= 0)
			message.push(`Avg. Ping ${average}ms`);

		const maximum = Math.max(...latencies);
		if (maximum >= 0)
			message.push(`Max. Ping ${maximum}ms`);		
	}

	if (alive.length > 0)
		message.push(`Alive ${alive.length}`);

	if (spectating.length > 0)
		message.push(`Spectating ${spectating.length}`);
	
	if (dead.length > 0)
		message.push(`Dead ${dead.length}`);
	
	if (reserved.length > 0)
		message.push(`Reserved ${reserved.length}`);
	
	if (frozen.length > 0)
		message.push(`Frozen ${frozen.length}`);
	
	console.log(message.join(' | '));
}, 12*1000);

wss.on('connection', ws => {
	console.log('Established connection with a client');
	
	/** @type {{socket:WebSocket;lobbyUrl:string;discordID:string;custom:{name:string?;tag:string?;skin:string?};movementEnabled:boolean,idleTimeout:NodeJS.Timeout?;captchaQueue:CaptchaQueue}} */
	let client = {
		socket: null,
		lobbyUrl: null,
		discordID: null,
		custom: {  /* user input values  */
			name: null,
			tag: null,
			skin: null
		},
		movementEnabled: false,
		idleTimeout: null,
		captchaQueue: null
	};
	
	/** @param {String} text */
	const log = text => {
		const {lobbyUrl:gameUrl} = client;
		if (!gameUrl) return;
		const packet = SmartBuffer.fromSize(1 + text.length + 1);
		packet.writeUInt8(2);
		packet.writeStringNT(text);
		ws.send(packet.toBuffer());
	}

	const inform = list => {
		/** @type {Array<Minion>} */
		const connected = [];
		/** @type {Array<Minion>} */
		const solving = [];
		/** @type {Array<Minion>} */
		const dead = [];
		/** @type {Array<Minion>} */
		const alive = [];
		/** @type {Array<Minion>} */
		const spectating = [];
		/** @type {Array<Minion>} */
		const reserved = [];
		/** @type {Array<Minion} */
		const frozen = [];
	
		list.forEach(m => {
			if (m.active && m.connected) {
				if (m.alive)
					alive.push(m);
				else if (m.spectating)
					spectating.push(m);
				else
					dead.push(m);
				
				if (m.frozen)
					frozen.push(m);
	
				connected.push(m);
			}
			else if (m.active && m.solvingCaptcha)
				solving.push(m);
		});
		
		const message = [];
	
		message.push(`Connected ${connected.length}`);
		message.push(`Solving ${solving.length}`);
		
		if (connected.length > 0 && connected.some(m => m.latency > 0)) {
			const latencies = connected.map(m=>m.latency).filter(x=>x>0);
	
			const average = Math.floor(latencies.reduce((a,v,i)=>(a*i+v)/(i+1)));
			if (average >= 0)
				message.push(`Avg. Ping ${average}ms`);
	
			const maximum = Math.max(...latencies);
			if (maximum >= 0)
				message.push(`Max. Ping ${maximum}ms`);		
		}
	
		if (alive.length > 0)
			message.push(`Alive ${alive.length}`);
	
		if (spectating.length > 0)
			message.push(`Spectating ${spectating.length}`);
		
		if (dead.length > 0)
			message.push(`Dead ${dead.length}`);
		
		if (reserved.length > 0)
			message.push(`Reserved ${reserved.length}`);
		
		if (frozen.length > 0)
			message.push(`Frozen ${frozen.length}`);
		
		log(message.join(' | '));		
	}

	ws.on('message', message => {
		const reader = SmartBuffer.fromBuffer(message);

		const {lobbyUrl:gameUrl} = client;
		const activeMinions = gameUrl ? [...minions.values()]
			.filter(m => m.client === client && m.serverUrl === gameUrl) : [];

		const op = reader.readUInt8();
		switch (op) {
			case 1: {
				let i = 0; 

				activeMinions.forEach(m => {
					if (m.follow || (global.spamming && !m.reserved))
						return;

					setTimeout(() => m.spawn(), getRandomNumber(0.8, 1.3) * ++i);
				});
				
				return;
			}

			case 2: {
				const x = reader.readInt16LE();
				const y = reader.readInt16LE();

				let i = 0; 

				activeMinions.forEach(m => {
					setTimeout(() => m.mouse(x, y), getRandomNumber(0.17, 0.23) * ++i)
				});

				return;
			}

			case 3: {
				const count = reader.readUInt8();

				let i = 0; 

				activeMinions.forEach(m => {
					if ( m.follow || (global.spamming && !m.reserved))
						return;

					setTimeout(() => m.split(count), getRandomNumber(0.6, 1.1) * ++i);
				});
                
				return;
			}

			case 4: {
				const state = reader.remaining() === 1 && !!reader.readUInt8();

				let i = 0; 

				activeMinions.forEach(m => {
					if (m.follow || (global.spamming && !m.reserved))
						return;

					setTimeout(() => m.feed(state), getRandomNumber(0.7, 1.3) * ++i);
				});

				return;
			}

			case 5: {
				const count = reader.readUInt8();

				if (count <= 0 || count >= 1000)
					return;

				const {lobbyUrl:gameUrl} = client;
				const slots = [...minions.values()].filter(m => m.serverUrl === gameUrl && !m.active && !m.started);

				const availableSlots = slots.length;
				if (count > availableSlots) {
					if (availableSlots > 0) {
						log(`There is only ${availableSlots} available minion${slots.length > 1 ? 's' : ''}`);
					} else {
						log('There are no available minions');
					}					
					return;
				}

				const requestedSlots = slots.splice(0, count);

				process.nextTick(() => {
					log(`Connecting ${count} minion${count > 1 ? 's' : ''}`);

					requestedSlots.forEach(m => {
						m.client = client;
						
						m.init().then(success => {
							if (!success) {
								console.warn(`Connection for minion '${m.id}' failed`);
								return;
							}

							m.start();
						});
					});
				});
				
				return;
			}

			case 66: {
				const aliveMinions = [...minions.values()].filter(x => x.active);
				aliveMinions.forEach(minion => minion.stop());
				// playerManager.reset();
				console.log(`Disconnected ${aliveMinions.length} minions(s)`);
				return;
			}

			case 6: {
				const message = decodeURIComponent(reader.readString());
				activeMinions.forEach(minion => minion.chat(message));
				return;
			}

			case 7: {
				const pid = reader.readUInt16LE();
				activeMinions.forEach(minion => minion.spectate(pid));
				return;
			}

			case 8: {
				const url = reader.readStringNT();
				const id = reader.readStringNT();

				if (!clientMap.has(id)) {
					client.discordID = id;
                	clientMap.set(id, client);
				} else {
					client = clientMap.get(id);

					if (client.socket?.readyState === WebSocket.OPEN) {
						log('Minion server only works with one client tab');
						ws.close();
						return;
					}

					if (client.idleTimeout) {
						clearTimeout(client.idleTimeout);
						delete client.idleTimeout;
					}

					// update the existing minions
					minions.forEach(m => {
						const {client} = m;
						if (client && client.discordID === id)
							m.client = client;
					});
				}
				
				console.log(`Client '${id}' ${clientMap.has(id) ? 're-' : ''}connected`);

				client.lobbyUrl = url;

				// assign the active websocket connection
				client.socket = ws;

				const captchaQueue = client.captchaQueue ?? (client.captchaQueue = new CaptchaQueue());
				// start the captcha queue for this client 
				captchaQueue.start(ws);

				console.log(`Connected to server URL '${client.lobbyUrl}'`);
				log('Connected to minion server');
				
                // start the bot client 
                const packet = SmartBuffer.fromSize(1);
                packet.writeUInt8(3);
                ws.send(packet.toBuffer());
				return;
			}

			case 9: {
				const state = !!reader.readUInt8();
				client.movementEnabled = state;
				log(`Minion movement ${state ? 'enable' : 'disable'}d`);
				return;
			}

			case 10: { // UInt16, String
				const token = new Token(reader.readStringNT());
				const id = reader.readInt32LE();
				const {captchaQueue:queue} = client;
				if (queue) {
					queue.handleToken(token, id);
				}
				return;
			}

            case 11: {
				if (client.discordID)
					console.log(`Ponging client ${client.discordID}`);
                const packet = SmartBuffer.fromSize(1);
                packet.writeUInt8(4);
                ws.send(packet.toBuffer());
                return;
            }

			case 12: {
				const{custom} = client;
				custom.name = reader.remaining() !== 0 && decodeURI(reader.readStringNT());
				log(custom.name ? `Updated static name to '${encodeURI(custom.name)}'` : `Removed static name`);
				return;
			}

			case 13: {
				const{custom} = client;
				custom.tag = reader.remaining() !== 0 && decodeURI(reader.readStringNT());
				log(custom.tag ? `Updated static tag to '${encodeURI(custom.tag)}'` : `Removed static tag`);
				return;
			}

			case 14: {				
				const{custom} = client;
				custom.skin = reader.remaining() !== 0 && reader.readStringNT();
				log(custom.skin ? `Updated static skin to '${custom.skin}'` : `Removed static skin`);
				return;
			}

			case 15: {
				const minion = activeMinions.reduce((prev, curr) => prev.latency > curr.latency ? prev : curr);								
				if (!minion) return;
				console.log(`Disconnecting minion '${minion.id}' for client '${client.discordID}'`);				
				log(`Disconnecting minion '${minion.id}'`);
				minion.stop();
				delete minion.client; /* remove user ownership */
				return;
			}

			case 16: {
				activeMinions.forEach(m => {
					if (global.spamming && !m.reserved)
						return;

					m.lineSplit();
				});

				return;
			}

			case 17: {
				const pid = reader.remaining() === 0 ? null : reader.readUInt32LE();
				
				const m = pid && activeMinions.find(m => m.playerId === pid);

				activeMinions.forEach(x => {
					if (!m && x.follow) {
						log(`Unfocused minion '${x.id}' (splits with other minions)`);
					}
					
					if (!m) {
						x.follow = false;
						delete x.unsafeMovement;
					}
				});

				if (m) {
					if (m.follow) {
						log(`Prioritized minion '${m.id}' (has unsafe mouse input)`);
						m.follow = false;
						m.unsafeMovement = true;
					} else {
						log(`Focused minion '${m.id}' (only other minions take input)`);						
						m.follow = true;
					}
				}
								
				return;				
			}

			case 18: {
				const state = !!reader.readUInt8();
				config.autoRespawn = !!state;
				return;
			}

			case 19: {
				const pid = reader.readUInt16LE();
				const {lobbyUrl:gameUrl} = client;
				const minion = activeMinions.find(m => m.serverUrl === gameUrl && m.playerId === pid);	
				if (!minion) return;
				minion.frozen = !!reader.readUInt8();
				console.log(`Minion '${minion.id}' ${minion.frozen ? 'frozen' : 'thawed'}`);
				log(`${minion.frozen ? 'Froze' : 'Thawed'} minion '${minion.id}'`);
				return;
			}

			case 20: {
				let count = reader.readUInt8();

				if (count === 0) {
					minions.forEach(minion => {
						if (minion.reserved)
							delete minion.reserved;
					});					
					return;
				}

				const {lobbyUrl:gameUrl} = client;
				const reservableMinions = activeMinions.filter(m => m.serverUrl === gameUrl);

				if (count > reservableMinions.length)
					return;

				const reservedMinions = reservableMinions.splice(0, count);

				console.log(`Reserving ${count} minions`);

				reservedMinions.forEach(minion => {
					minion.reserved = true;
				});

				return;
			}

			case 21: {				
				inform(activeMinions);
				return;
			}

			case 81: {
				const type = reader.readUInt8();

				let value;

				switch (type) {
					case 0: value = reader.readStringNT(); break;
					case 1: value = reader.readUInt32LE(); break;
					case 2: value = !!reader.readUInt8(); break;
					default: return;
				}

				const name = reader.readStringNT();	
				console.log(`Ovewriting config value for '${name}' with '${value}'`);

				config[name] = value;
				return;
			}

			case 86: {
				const state = !!reader.readUInt8();

				clearInterval(global.spawnInterval);
				clearInterval(global.splitInterval);

				if (global.feedInterval) {
					clearInterval(global.feedInterval);
					delete global.feedInterval;
				}

				if (state) {
					global.spamming = true;
	
					const tick = 50; /* 50ms = 1 tick */

					global.spawnInterval = setInterval(() => {
						activeMinions.forEach(minion => {
							if (minion.reserved)
								return;
							
							if (!minion.autoSpawning)
								minion.spawn();
						});
					}, tick*1.15);
				} else {
					delete global.spamming;
				}

				return;
			}

			case 87: {
				const state = !!reader.readUInt8();

				clearInterval(global.spawnInterval);
				clearInterval(global.splitInterval);

				if (global.feedInterval) {
					clearInterval(global.feedInterval);
					delete global.feedInterval;
				}

				if (state) {
					global.spamming = true;
	
					const tick = 50; /* 50ms = 1 tick */

					global.spawnInterval = setInterval(() => {
						activeMinions.forEach(minion => {
							if (minion.reserved)
								return;
							
							if (!minion.autoSpawning)
								minion.spawn();
						});
					}, tick*1.15);

					global.splitInterval = setInterval(() => {
						activeMinions.forEach(minion => {
							if (minion.reserved)
								return;
							
							if (minion.alive)
								minion.lineSplit();
						});
					}, 2000);
				} else {
					delete global.spamming;
				}

				return;
			}

			case 88: {
				const state = !!reader.readUInt8();

				clearInterval(global.spawnInterval);
				clearInterval(global.splitInterval);

				if (global.feedInterval) {
					clearInterval(global.feedInterval);
					delete global.feedInterval;
				}

				if (state) {
					global.spamming = true;
	
					const tick = 50; /* 50ms = 1 tick */

					global.spawnInterval = setInterval(() => {
						activeMinions.forEach(minion => {
							if (minion.reserved)
								return;
							
							if (!minion.autoSpawning)
								minion.spawn();
						});
					}, 80);

					global.splitInterval = setInterval(() => {
						activeMinions.forEach(minion => {
							if (minion.reserved)
								return;
							
							if (minion.alive)
								minion.split(5);
						});
					}, 60);

					global.feedInterval = setInterval(() => {
						activeMinions.forEach(minion => {
							if (minion.reserved)
								return;
							
							if (minion.alive)
								minion.feed(true);
						});
					}, 20);
				} else {
					delete global.spamming;
				}

				return;
			}
			
			default: {
				ws.close(1003, 'Invalid opcode');
				return;
			}
		}
	});

    ws.on('close', () => {
		const {discordID:id} = client;
        console.warn(`Connection lost with ${id ? `client '${id}'` : 'a client'}`);

		client.movementEnabled = false;

		client.idleTimeout = setTimeout(() => {
			const {discordID:id} = client;
			clientMap.delete(id);
			console.log(`Disconnecting minion(s) of idle client '${id}'`);
			const {captchaQueue:queue} = client;
			if (queue) {
				queue.clear(client);
			}
			minions.forEach(m => {
				if (m.client === client) {
					m.stop();
					delete m.client; /* remove user ownership */
				}
			});
			client = null;
		}, 300*1000); /* 5 minute timeout */
    });
});
