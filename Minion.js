
import WebSocket from 'ws';
import { SmartBuffer } from 'smart-buffer';
import * as url from 'url';
import fetch from 'node-fetch';

import { getConfig, clientMap } from './index.js';
import { getCaptchaToken } from './CaptchaQueue.js';
import { XorKey } from './Authenticator.js';
import { generateChinese, generateBinary, getCharacter, noop, subOrAdd, getRandomNumber } from './util.js';
import { Token } from './Token.js';
import { proxyManager } from './ProxyManager.js';

import { Vector2d } from './Vector2d.js';

import { parseOwnCells } from './cells/Parsers.js';
import { existsSync, readFileSync } from 'fs';
import HttpsProxyAgent from 'https-proxy-agent';

// common FPS timings
const frameTimes = [60 /*90, 120<extras>,*/ /*, 240*/].map(x => x / 1000);

console.log('Ready!');

if (false) {
	global.console = {
		warn: noop,
		log: noop,
		error: noop
	};
}

/** @type {Array<Token>} */
export const tokens = [];


/** @type {Set<Minion>} */
export const minions = new Set();

export let minionCount = 0;

export class Minion {
    /**
     * @param {string} serverUrl 
	 * @param {HttpsProxyAgent} agent
     */
	constructor(serverUrl, agent) {
        /** @type {string} */
        this.serverUrl = serverUrl;

		/** @type {boolean} */
		this.started = false;

		/** @type {{connectionUrl:string,discordID:string,custom:{name:string?,tag:string?,skin:string?}}} */
        this.client = null;

		/** @type {number} */
		this.id = ++minionCount;

		/** @type {boolean} */
		this.solvingCaptcha;

		/** @type {Token} */
		this.captchaToken;

		/** @type {string} */
		this.token;

		/** @type {number} */
		this.pingStamp = 0;

        /** @type {number} */
        this.latency = -1;
		
		/** @type {number} */
		this.pauseMovementUntil = 0;

		/** @type {boolean} */
		this.frozen;

		/** @type {boolean} */
		this.reserved;

		/** @type {HttpsProxyAgent} */
		this.agent = agent;

		/** @type {number} */
		this.seed = Math.random();

		/** @type {number} */
		this.randomDistance = getRandomNumber(2000, 3000);

		/** @type {number} */
		this.offset = getRandomNumber(70, 100);
		
		/** @type {boolean} */
		this.alive;

		/** @type {boolean} */
		this.spectating;

		/** @type {Vector2d} */
		this.position = new Vector2d();

		/** @type {Vector2d} */
		this.newPosition = new Vector2d();
		
		/** @type {Vector2d} */
		this.mousePosition = new Vector2d(); // mouse position of the player that owns this minion

		/** @type {number} */
		this.deathTime = 0;

		/** @type {boolean} */
		this.follow;

		/** 
		 * If enabled, the minion will be given the users' raw mouse position.
		 * @type {boolean} 
		 **/
		this.unsafeMovement;
	}

	/** 
	 * @param {string} message 
	 * @returns {boolean}
	 */
	log(message) {
		for (const[id, client] of clientMap) {
			if (client !== this.client) continue;
			const {socket} = client;
			if (socket.readyState !== WebSocket.OPEN) /* user client isn't connected */
				return false;

			const packet = SmartBuffer.fromSize(1 + message.length + 1);
			packet.writeUInt8(2);
			packet.writeStringNT(message);
			socket.send(packet.toBuffer());
			return true;
		}
	}
	
	/** @returns {Promise<boolean>} */
	init() {
		// __cmpcccx13566 = aBPX1LM_gAACQAXABgAEIARQHAAAAA
		// StatsSend = true
		// userFromEEA = true
		// CountryCode = ?? (use GB)

		// if (!this.headers) {
		// 	const cookies = ['CountryCode=GB', 'userFromEEA=true'];

		// 	const rc = 'CPaWNJgPaWNJgAfYeBENCTCgAP_AAH_AAAigG7pV9W_xxxxxxxxxxxxxxxxxxxxxx-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxAAAAAQACAGAEAAgAAAABMIAAAAAAAAAAECAAgbulX1b9dpc2N4-ntruwRghRfXXu3j5CEOAIATiAHIcoBwhAZWYDsgDIAkqAKgECAgVkAhBWwISQBBQIAggBEAEcgAABAiAkIgIoQIIRkSQAAACBg'.replace(/[xy]/g, c => {
		// 		const r = Math.random()*35|0, v = c == 'x' ? r : (r&0x3|0x8);
		// 		const s = v.toString(36);
		// 		return Math.random() > 0.2 ? s.toUpperCase() : s;
		// 	});

		// 	cookies.push(`__cmpconsentx13566=${rc}`);
		// 	cookies.push('__cmpcccx13566=aZPX02dcgAACQAXAChBFIARQHAAAAA');
		// 	cookies.push(`__gads=ID=${Math.floor(Math.random()*16777215).toString(16)}14ecabaaba:T=1953329006:S=ANAL_MYmzLt_apbHHuBar4XoWx2XGA2bcA`);

		// 	// __gads=ID=6141487d1779cf1a:T=1653329006:S=ALNI_MYmzLt_apbHHuBar4XoWx2XGM2bbA; 
		// 	// __cmpconsentx13566=CPaWNJgPaWNJgAfYeBENCTCgAP_AAH_AAAigG7pV9W_XaXNjePp7a7sEYIUX117t4-QhDgCAE4gByHKAcIQGVmA7IAyAJKgCoBAgIFZAIQVsCEkAQUCAIIARABHIAAAQIgJCICKECCEZEkAAAAgYAAAAAAAQACAGAEAAgAAAABMIAAAAAAAAAAECAAgbulX1b9dpc2N4-ntruwRghRfXXu3j5CEOAIATiAHIcoBwhAZWYDsgDIAkqAKgECAgVkAhBWwISQBBQIAggBEAEcgAABAiAkIgIoQIIRkSQAAACBgAAAAAABAAIAYAQACAAAAAEwgAAAAAAAAAAQIACAAA;
		// 	// __cmpcccx13566=aBPaWpJ2gABOwABAAMAA8ACwANAAmABWAC4AMAAagA4AD0AIAAiABQAC4AGMAMwA0ABwADwAH0AQABBACGAEWAJYAmgBXAC8AGYAOgAewA-wB_AICAQ4BEACLAEwAKEAVQAvABiADHAGUANGAbABsgD4AH7AQsBDICHgIgARMAjQBHQCSAEsAJgATgAngBRgCngFXALIAWaAxoDHAGVAM2AaEA3wByQDmAHUAPEAesA-YCAAEDAITAQ6Ah8BEkCJwIoARaAj0BIQCTAEugJyATwAoOBRoFHgKaAVAAq4Ba4C4wGBgMGAZMA0EBpoDUYG5gbtA3gDeQG-wOAA4IBw0DiQOKAckA7gB5YDzgHogPbAgzBBsEHAIkwRMBE0CKAEwAJlgUXgpeCmAFPQKigVOAsCBZcCzIFogLUAW8AuHBjcGOANLAa1A3IBvEDpQHjAPRge2A-KB9MEG4IdAQ9giDBFOCKwEb4I9gR_AkoBJfCTIJMwSgwlSCVME28JvAm9BPsCh0FGAKNAUegpHAAA

		// 	cookies.push('StatsSend=true');

		// 	const headers = {
		// 		Accept: 'application/json, text/plain, */*',
		// 		...generateHeaders(),
		// 		Cookie: cookies.join('; '),
		// 		// fake creds
		// 		'sec-ch-ua': '\".Not/A)Brand\";v=\"99\", \"Google Chrome\";v=\"103\", \"Chromium\";v=\"103\"',
		// 		'sec-ch-ua-mobile': '?0',
		// 		'sec-ch-ua-platform': '\"Windows\"',
		// 		'sec-fetch-dest': 'empty',
		// 		'sec-fetch-mode': 'cors',
		// 		'sec-fetch-site': 'same-site'
		// 	};

		// 	if (headers.Origin)
		// 		headers.Referer = headers.Origin; 

		// 	this.headers = headers;
		// }

		return new Promise(resolve => {
			const url = this.serverUrl.replace('ws', 'http');
			fetch(url, {
				headers: {
					'Origin': 'https://vanis.io',
					'Referer': 'https://vanis.io/',
					'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/104.0.0.0 Safari/537.36',
					'Cookie': 'CountryCode=GB; userFromEEA=true',
					'Accept': 'application/json, text/plain, */*',
					'Accept-Encoding': 'gzip, deflate, br',
					'Accept-Language': 'en-US,en;q=0.9',
					'sec-ch-ua': '".Not/A)Brand";v="99", "Google Chrome";v="104", "Chromium";v="104"',
					'sec-ch-ua-mobile': '?0',
					'sec-ch-ua-platform': '"Windows"',
					'sec-fetch-site': 'same-site',
					'sec-fetch-mode': 'cors',
					'sec-fetch-dest': 'empty'
				},
				agent: this.agent
			})
			.then(r => resolve(r.status === 200)) // can be caused by proxy list being outdated btw
			.catch(() => resolve(false));
		});
	}

	start() {
        this.started = true;

		this.ws = new WebSocket(this.serverUrl, 'tFoL46WDlZuRja7W6qCl', {
			headers: {
				'Origin': 'https://vanis.io',
				'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/104.0.0.0 Safari/537.36',
				// TODO: full headers maybe
				'Cookie': 'CountryCode=GB; userFromEEA=true',
				'Pragma': 'no-cache',
				'Cache-Control': 'no-cache',
				'Accept-Encoding': 'gzip, deflate, br',
				'Accept-Language': 'en-US,en;q=0.9',
			},
			agent: this.agent,
			rejectUnauthorized: false
		});

		this.ws.binaryType = 'nodebuffer';

		this.ws.on('message', this.handleMessage.bind(this));
		this.ws.on('open', this.onOpen.bind(this));
		this.ws.on('close', this.onClose.bind(this));
		this.ws.on('error', noop);
	}

	stop() {
        if (this.ws) {
            this.ws.close();
            delete this.ws;
        }

		delete this.started;

		delete this.connected;
		delete this.opened;

        // delete this.client;

		if (this.retryAttempts)
			delete this.retryAttempts;

        delete this.solvingCaptcha;

        delete this.captchaToken;

        delete this.token;

        this.pingStamp = 0;

        this.latency = -1;		

		this.pauseMovementUntil = 0;

        delete this.frozen;

        delete this.reserved;

		delete this.alive;

		delete this.spectating;

		this.position.reset();

		this.newPosition.reset();

		this.mousePosition.reset();

		delete this.deathTime;

		delete this.follow;

		delete this.unsafeMovement;

		if (this.pingInterval) {
			clearInterval(this.pingInterval);
			delete this.pingInterval;
		}

		if (this.tickInterval) {
			clearInterval(this.tickInterval);
			delete this.tickInterval;
		}

		if (this.moveInterval) {
			clearInterval(this.moveInterval);
			delete this.moveInterval;
		}

		if (this.spawnTimeout) {
			clearInterval(this.spawnTimeout);
			delete this.spawnTimeout;
		}

        if (this.spawnerTimeout) {
            clearTimeout(this.spawnerTimeout);
            delete this.spawnerTimeout;
        }

		if (this.connectTimeout) {
			clearInterval(this.connectTimeout);
			delete this.connectTimeout;
		}
	}

	/** @param {Buffer} message */
	handleMessage(message) {
		const reader = SmartBuffer.fromBuffer(message);

		switch (reader.readUInt8()) {
			case 1: {
				this.initialData(reader);
				return;
			}

			case 2: {
				const key = message.slice(1);
				this.authenticate(new XorKey(key).build());
				return;
			}

			case 3: {
                this.latency = Date.now() - this.pingStamp;
				return;
			}

			case 6: {
				this.pong();
				return;
            }

			case 10: {
				this.computeCells(reader);
				return;
			}

			case 20: {
				if (!getConfig().autoRespawn)
					return;
				
				this.autoSpawning = true;
				this.delayedSpawn(getConfig().respawnDelay);
				this.deathTime = Date.now();
				return;
			}

			case 22: {
				if (!this.opened)
					return;

				setTimeout(() => {
					if (this.captchaToken) {
						this.log(`Got captcha token for minion '${this.id}'`);
						this.sendRecaptchaToken(this.captchaToken);
						delete this.captchaToken;
						return;
					}

					if (tokens.length > 0) {
						this.log(`Got cached captcha token for minion '${this.id}'`);
						this.sendRecaptchaToken(tokens.shift());
						return;
					}


					if (this.solvingCaptcha)
						return;

					this.solvingCaptcha = true;
					const {client} = this;
					if (!client?.captchaQueue) return;
					client.captchaQueue.add(this);
				}, getRandomNumber(200, 300));

				return;
			}

			default: return;
		}
	}

	onOpen() {
		this.log(`Minion '${this.id}' ${this.solvingCaptcha ? 're-' : ''}connected`);

		this.opened = true;
	}

	/** 
	 * @param {number} code
	 * @param {Buffer} messageBuffer
	 */
	onClose(code, messageBuffer) {
		if (!this.opened) {
			this.log(`Minion '${this.id} failed to connect`);
			return;
		} else if (code === 1003) { /* server restart */
			this.stop();
			delete this.client;
			return;
		}
				
		const message = messageBuffer.toString('utf8');

		if (this.solvingCaptcha && message.toLowerCase() !== 'captcha failed') {
			const {client} = this;
			if (client?.captchaQueue)
				client.captchaQueue.remove(this);		
			this.stop();
			delete this.client;
		}
		else {
			if (code === 1006 && this.started) {
				this.log(`Minion '${this.id}' was kicked (probably bot protection)`);
				this.stop();
				delete this.client;
				return;
			}

			if (false && message.toLowerCase() === 'banned by a moderator' && this.connected) {
				throw new Error(`Minion '${this.id}' was banned; crashing server to prevent further bans`);

				console.warn(`Minion '${this.id}' was banned; disconnecting remaining minion(s)`);

				minions.forEach(minion => {
					if (minion.active)
						minion.stop();
				});
			} 
			else if (message.toLocaleLowerCase() === 'invalid opcode' && this.lastOp) {
				console.warn(`Minion '${this.id}' disconnected (last operation: ${this.lastOp}, recieved operation: ${this.recievedOp})`);
			}
			else {
				this.log(`Minion '${this.id}' disconnected${message ? ` (${message})` : ''}`);
			}

			this.stop();
			delete this.client;
		}
	}

	get active() {
		return this.ws && this.ws.readyState === WebSocket.OPEN;
	}

	/** @param {SmartBuffer} data */
	send(data) {
		if (this.active) {
			this.ws.send(data.toBuffer());
		}
	}

	/** @param {SmartBuffer} reader */
	initialData(reader) {
		if (!this.opened)
			return;
			
        const protocol = reader.readUInt8();	
		if (protocol >= 2) {
			this.playerId = reader.readUInt16LE(5);
		} else {
			this.playerId = reader.readUInt16LE(3);
		}
		
		setTimeout(() => {
			// start of timeout
			this.timerStamp = Date.now();
	
			this.spawn();
		}, getRandomNumber(100, 200));

		const delay = [2000, 3000, 4000].sort(() => Math.random() - 0.3)[0];
		setTimeout(() => {
			delete this.timerStamp;

			if (!this.started || !this.active)
				return;

			this.connected = true;

			this.log(`Minion ${this.id} is ready with movement disabled`);
		}, delay);

		this.pingInterval = setInterval(() => {
			if (this.connected && this.alive) /* simulate death and when deathscreen is visible after 1m */
				this.ping();
		}, 1000); // simulate 'game.everySecond' delay offset

		this.moveInterval = setInterval(this.move.bind(this), getConfig().movementDelay);
		
		this.tickInterval = setInterval(this.tick.bind(this), 60/1000);		
	}

	get movementEnabled() {
		const {client} = this;
		return !!client && client.movementEnabled;
	}

	/** @param {SmartBuffer} reader */
	computeCells(reader) {
		this.timeStamp = Date.now();

		const cells = parseOwnCells(reader, this.playerId);

		this.alive = cells.size !== 0;

		if (!this.alive) /* opt: minion isn't alive */
			return;
		else if (this.spectating)
			delete this.spectating; /* delete temporary state */

		if (this.pauseComputation || !!this.client?.movementEnabled) /* opt: no movement needed */
			return;

		const {mousePosition} = this;

		const distances = [...cells.values()].map(c => {
			const d = c.position.subtract(mousePosition);
			return Math.sqrt(Math.abs(d.magnitudeSq)) - c.size;
		})

		this.closestDistance = Math.min.apply(null, distances);

		if (this.mouseChanged) {
			delete this.mouseChanged;
			
			mousePosition.set(
				subOrAdd(mousePosition.x, this.offset, this.seed, 0.6),
				subOrAdd(mousePosition.y, this.offset, this.seed, 0.3)
			);
		}

		// position for the minion to move towards
		const targetPos = new Vector2d();

		if (!this.unsafeMovement && this.closestDistance > 330) { /* minion is near player's mouse */
			cells.forEach(cell => {
				targetPos.addTo(cell.position);
			});
	
			targetPos.divideBy(cells.size);
			
			if (this.closestDistance >= 8500) {
				if (this.frozen || this.debounce)
					return;
				this.debounce = true;
				this.frozen = true;
				
				// disable macro feed if active
				this.feed(false);

				this.spawnerTimeout = setTimeout(() => {
					if (!this.debounce)
						return;
				
					const elapsed = !this.deathTime ? 0 : Date.now() - this.deathTime;
					const delay = (elapsed < 6e4) ? getRandomNumber(400, 600) + getConfig().respawnDelay : getRandomNumber(2500, 3000);

					this.spawnerTimeout = setTimeout(() => {
						if (this.debounce) {
							if (this.frozen)
								this.frozen = false;
							delete this.debounce;
							if (!this.active || this.alive && this.closestDistance <= 1500)
								return;
							this.spawn();
						}
					}, delay);
				
					// this.spawnerTimeout = this.delayedSpawn(getRandomNumber(700, 800));
				}, 1500);

			} else if (this.debounce) {
				// console.log(`Minion '${this.id}' is close to the host`);
				delete this.debounce;
				this.frozen = false;
				if (this.spawnerTimeout) {
					clearTimeout(this.spawnerTimeout);
					delete this.spawnerTimeout;
				}
			}

			const journey = mousePosition.subtract(targetPos);

			const direction = journey.angle; // direction of movement
			const distance = Math.min(this.randomDistance, journey.magnitude); // distance until end of the journey

			targetPos.x += Math.cos(direction) * distance;
			targetPos.y += Math.sin(direction) * distance;
		} else {
			targetPos.set(mousePosition);
		}
		
		// make sure new position fits
		targetPos.clamp(-32768, 32767);

		this.newPosition.set(targetPos);
	}

	tick() {
		this.timeStamp = Date.now();
			
		if (this.timeStamp >= this.pauseMovementUntil) {
			this.position.set(this.newPosition);
			this.splitCount = 0;
		}
	}

	/**
	 * @param {SmartBuffer} packet 
	 * @param {boolean} first 
	 */
	writeClientData(packet, first) {
		const config = getConfig();

		if (first) {
			this.name = config.getName();
			this.tag = config.getTag();
		}

		if ((first && config.skinOnJoin) || (!first && config.skinOnSpawn))
			this.skin = config.getSkin();
		else
			this.skin = 'vanis1';

		const {custom} = this.client;

		/** @type {String} */
		const name = custom.name ?? this.name;
		/** @type {String} */
		const tag = custom.tag ?? this.tag;
		/** @type {String} */
		const skin = custom.skin ?? this.skin;

		packet.writeStringNT(
			name === this.name ? name :
			name === 'chinese' ? generateChinese(9) :
			name === 'binary' ? generateBinary(12) :
			name === 'random' ? config.getName() :
			name === 'random-keep' ? (this.name = config.getName()) :
			name === 'alphabet' ? getCharacter((this.id - 1) % 51) :
			name === 'minion' ? `Minion ${this.id}` :
			name === 'teammate' ? `Teammate ${this.id}` :
			name === 'lagger' ? Math.random() > 0.4 ? generateChinese(10) : config.getName() : name
		);		
		packet.writeStringNT(`https://skins.vanis.io/s/${skin}`);
		packet.writeStringNT(
			tag === 'chinese' ? generateChinese(15) : tag
		);
	}

	/** @param {Array<number>} key */
	authenticate(key) {
		if (!this.active) return;
		const packet = SmartBuffer.fromSize(1 + 1 + key.length);
		packet.writeUInt8(5);
		packet.writeUInt8(18);
		key.forEach(x => packet.writeUInt8(x));
		this.writeClientData(packet, true);
		this.token && packet.writeStringNT(this.token);
		this.send(packet);
	}

	spawn() {
		if (!this.active || this.frozen)
			return;

		if (this.spawnTimeout) {
			clearTimeout(this.spawnTimeout);
			delete this.spawnTimeout;
		}

		const packet = SmartBuffer.fromSize(1);
		packet.writeUInt8(1);
		this.writeClientData(packet, false);
		this.send(packet);
	}

	/** @param {number} delay */
	delayedSpawn(delay) {
		const elapsed = this.deathTime ? Date.now() - this.deathTime : 0;
		const offset = (elapsed < 6e4) ? 0 : getRandomNumber(1700, 2000);
		return setTimeout(() => {
			if (this.autoSpawning)
				delete this.autoSpawning;
			this.spawn();
		}, delay + offset);
	}

	/** @param {number} count */
	split(count) {
		if (this.frozen)
			return;

		if (!!this.client?.movementEnabled)
			this.move();

		const packet = SmartBuffer.fromSize(2);
		packet.writeUInt8(17);
		packet.writeUInt8(count);
		this.send(packet);

		this.splitCount += count;

		if (this.splitCount <= 2)
			this.pauseMovementUntil = Date.now() + 300;
		else {
			this.pauseMovementUntil = 0;
			this.splitCount = 0;
		}
	}

	lineSplit() {
		this.pauseComputation = true;
		this.split(3);

		if (this.releaseTimeout) {
			clearTimeout(this.releaseTimeout);
		}
		
		this.releaseTimeout = setTimeout(() => {
			delete this.releaseTimeout;
			delete this.pauseComputation;
		}, 1500);
	}

	/**
	 * @param {number} x 
	 * @param {number} y 
	 */
	mouse(x, y) {
		this.mousePosition.set(x, y);
		this.mouseChanged = true;
	}

	move() {
		if (!!this.timerStamp) {
			const e = Date.now() - this.timerStamp;
			if (e > 500 && !this.dummyPosition) { /* simulate fake mouse */
				this.dummyPosition = new Vector2d(
					Math.random() > 0.6 ? -getRandomNumber(0, 9600) : getRandomNumber(0, 9580),
					Math.random() > 0.3 ? -getRandomNumber(0, 9600) : getRandomNumber(0, 9580)
				);
			} else if (e < 500) {
				const packet = SmartBuffer.fromSize(1);
				packet.writeUInt8(9);
				this.send(packet);
				return;
			}
			
			// empty position is sent when connection is established
			const packet = SmartBuffer.fromSize(5);
			packet.writeUInt8(16);
			packet.writeInt16LE(this.dummyPosition?.x || 0);
			packet.writeInt16LE(this.dummyPosition?.y || 0);
			this.send(packet);
			return;
		}
				
		if (!!this.client?.movementEnabled || this.frozen) {
			const packet = SmartBuffer.fromSize(1);
			packet.writeUInt8(9);
			this.send(packet);
			return;
		}

		const {x:mx, y:my} = this.position;
		const packet = SmartBuffer.fromSize(5);
		packet.writeUInt8(16);
		packet.writeInt16LE(mx);
		packet.writeInt16LE(my);
		this.send(packet);
	}

	/** @param {boolean} state */
	feed(state) {
		if (this.frozen) return;
		const macro = arguments.length > 0;
		const packet = SmartBuffer.fromSize(2);
		packet.writeUInt8(21);
		macro && packet.writeUInt8(+state);
		this.send(packet);
	}

	/** @param {String} message */
	chat(message) {
		const packet = SmartBuffer.fromSize(1 + message.length);
		packet.writeUInt8(99);
		packet.writeString(message);
		this.send(packet);
	}

	/** @param {number} [pid]  */
	spectate(pid) {
		const packet = SmartBuffer.fromSize(pid ? 3 : 1);
		packet.writeUInt8(2);
		pid && packet.writeUInt16LE(pid);
		this.send(packet);
		this.spectating = !this.alive;
	}

	ping() {
		this.pingStamp = Date.now();
		const packet = SmartBuffer.fromSize(1);
		packet.writeUInt8(3);
		this.send(packet);
	}

	pong() {
		const packet = SmartBuffer.fromSize(1);
		packet.writeUInt8(6);
		this.send(packet);
	}

	/** @param {Token | String} token */
	sendRecaptchaToken(token) {
		if (!this.active && !this.captchaToken) {
			this.captchaToken = token;
			return;
		} else if (this.connected) {
			console.warn(`Minion '${this.id}' was already connected; caching captcha token`);
			tokens.push(typeof token === 'string' ? new Token(token) : token);
		}

		if (token instanceof Token) {
			if (!token.valid()) {
				console.warn(`Captcha token for minion '${this.id}' either expired or is invalid`);
				delete this.solvingCaptcha;
				this.stop();
				return;
			} else {
				token = token.toString();
			}
		}

		const packet = SmartBuffer.fromSize(1 + (token.length + 1));
		packet.writeUInt8(11);
		packet.writeStringNT(token);
		this.send(packet);

		delete this.solvingCaptcha;
	}
}

// load minion slots into list

if (!existsSync('./servers.json')) throw new Error('File "servers.json" for server list doesn\'t exist');

const l = JSON.parse(readFileSync('./servers.json', 'utf8'));
l.forEach(s => {	
	minionCount = 0;

	/** @type {Minion} */
	let prev = null;
    let count = s.maxPlayers;
    while (count--) {
		const cache = !!prev;

		const minion = new Minion(s.url, cache ? prev.agent : proxyManager.get());
        minions.add(minion);

		if (cache)
			prev = null;
		else
			prev = minion; 
    }

    console.log(`Loaded ${s.maxPlayers} minion${s.maxPlayers > 1 ? 's' : ''} for ${s.name}`)
});

console.log(`${minions.size} minion${minions.size > 1 ? 's' : ''} available`);