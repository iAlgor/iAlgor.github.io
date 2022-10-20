import WebSocket from 'ws';
import { SmartBuffer } from 'smart-buffer';
import { RecaptchaV2Task } from 'node-capmonster';

import { getConfig } from './index.js';
import { tokens, Minion } from './Minion.js';
import { Token } from './Token.js';

const captcha = new RecaptchaV2Task(getConfig().apiKey);

/** @returns {Promise<Token>} */
export const getCaptchaToken = () => {
	return new Promise(resolve => {
		captcha.createTask(
			'https://vanis.io',
			'6LfN7J4aAAAAAPN5k5E2fltSX2PADEyYq6j1WFMi'
		).then(taskId => {
			captcha.joinTaskResult(taskId)
				.then(result => {
					const { gRecaptchaResponse: token } = result;
					resolve(new Token(token));
				}).catch(() => resolve(null));
		});
	});
}

/**
 * Queue for managing Captcha solving jobs.
 */

export class CaptchaQueue {
	constructor() {
		/** @type {Array<Minion>} */
		this.waitingMinions = [];
	}

	/** @param {WebSocket} ws */
	start(ws) {
		this.ws = ws;
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

	/** @param {{socket:WebSocket;lobbyUrl:string;discordID:string;custom:{name:string?;tag:string?;skin:string?};idleTimeout:NodeJS.Timeout?;captchaQueue:CaptchaQueue}} target */
	clear(target) {
		const q = this.waitingMinions;		
		let c = q.length;

		while (c--) {
			const m = q[c];
            if (m.client !== target)
                continue;
			m.solvingCaptcha = false;
			m.stop();
            delete m.client;
		}
	}

	/** @param {Minion} m */
	remove(m) {
		const {waitingMinions:l} = this;
		const i = l.indexOf(m);
		
		if (i >= 0) {
			l.splice(i, 1);
            delete m.handlingCaptcha;
		}
	}

	/** @param {Minion} m */
	add(m) {
		if (!this.active/* || !m.active*/)
			return;

        // incase minion is already in queue
		this.remove(m);
            
        const {waitingMinions: l} = this;

		// check for other minions in queue
		if (l.length === 0)
		    this.requestToken(m);

		l.push(m);
	}

	/** 
	 * @param {Token} token 
	 * @param {number} id
	 */
	handleToken(token, id) {
        const {waitingMinions: l} = this;

		if (!this.active || l.length === 0)
			return;

		const m = l.find(x=>x.id===id);

		console.log(this.waitingMinions, m);
        
		if (!m)
			console.log('f');
		else if (m.active) {
			m.log(`Solved captcha token for minion '${id}'`);		
			m.sendRecaptchaToken(token);
		} else {
            m.log(`Captcha for minion '${id}' solved but minion disconnected; re-connecting`);

			m.captchaToken = token; /* store token for minion */
            m.init().then(() => m.start());
		}

		this.remove(m);
		
		if (l.length !== 0)
			this.requestToken(l[0]);
	}

	/** @param {Minion} m */
	requestToken(m) {
		console.log(`Requesting captcha token for minion ${m.id}`);
		const packet = SmartBuffer.fromSize(1+4);
		packet.writeUInt8(1);
		packet.writeInt32LE(m.id);
		this.send(packet);
	}
};