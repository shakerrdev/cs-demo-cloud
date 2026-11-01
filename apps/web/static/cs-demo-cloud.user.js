// ==UserScript==
// @name         cs-demo-cloud companion
// @namespace    https://github.com/shakerrdev/cs-demo-cloud
// @version      1.1.0
// @description  Send CS2 demos from FACEIT and other sites to your cs-demo-cloud
// @match        https://www.faceit.com/*
// @match        https://www.hltv.org/*
// @match        https://leetify.com/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @grant        GM_registerMenuCommand
// @grant        unsafeWindow
// @connect      *
// @run-at       document-start
// ==/UserScript==

(() => {
	'use strict';

	const demoLink = /^https?:\/\/[^\s"'<>]+\.dem(?:\.(?:bz2|gz|zst))?(?:\?[^\s"'<>]*)?$/i;
	const seen = new Set();
	let lastDemo = null;
	let button = null;

	const settings = () => ({
		server: String(GM_getValue('server', '')).replace(/\/+$/, ''),
		token: String(GM_getValue('token', ''))
	});

	function configure() {
		const current = settings();
		const server = prompt('cs-demo-cloud address (for example https://nas.local:3000)', current.server);
		if (server === null) return;
		const token = prompt('API token (Settings → API tokens, starts with cdc_)', current.token);
		if (token === null) return;
		GM_setValue('server', server.trim());
		GM_setValue('token', token.trim());
		toast('Saved');
	}

	GM_registerMenuCommand('Set server and token', configure);
	GM_registerMenuCommand('Send a demo link…', () => {
		const url = prompt('Demo link (.dem, .dem.gz, .dem.zst or .dem.bz2)', lastDemo ?? '');
		if (url) sendBest(url.trim());
	});

	function toast(text, link) {
		const box = document.createElement(link ? 'a' : 'div');
		if (link) {
			box.href = link;
			box.target = '_blank';
		}
		box.textContent = text;
		Object.assign(box.style, {
			position: 'fixed',
			right: '16px',
			bottom: '72px',
			zIndex: 2147483647,
			padding: '10px 14px',
			borderRadius: '8px',
			background: '#1d2127',
			color: '#f2f2f2',
			font: '13px system-ui, sans-serif',
			boxShadow: '0 4px 16px rgb(0 0 0 / 0.4)',
			textDecoration: 'none'
		});
		document.body.append(box);
		setTimeout(() => box.remove(), 6000);
	}

	async function signFaceit(resourceUrl) {
		for (const path of ['/api/download/v2/demos/download-url', '/api/download/v2/demos/download']) {
			try {
				const response = await originalFetch.call(page, path, {
					method: 'POST',
					credentials: 'include',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ resource_url: resourceUrl })
				});
				if (!response.ok) continue;
				const url = (await response.json())?.payload?.download_url;
				if (typeof url === 'string' && /^https:/.test(url)) return url;
			} catch {}
		}
		return null;
	}

	async function sendBest(url) {
		if (location.hostname.endsWith('faceit.com') && !isSigned(url)) {
			const signed = await signFaceit(url);
			if (!signed) {
				toast('Click FACEIT\'s own demo download button once, then send again');
				return;
			}
			url = signed;
		}
		send(url);
	}

	function send(url) {
		const { server, token } = settings();
		if (!server || !token) {
			configure();
			return;
		}
		toast('Sending demo to cs-demo-cloud…');
		GM_xmlhttpRequest({
			method: 'POST',
			url: `${server}/api/demos/url`,
			headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
			data: JSON.stringify({ url }),
			timeout: 30 * 60 * 1000,
			onload: (response) => {
				let body = {};
				try {
					body = JSON.parse(response.responseText);
				} catch {}
				if (response.status === 200 || response.status === 201) {
					toast(response.status === 200 ? 'Already in your library' : 'Demo queued', `${server}/demos/${body.id}`);
				} else {
					toast(`Failed (${response.status}): ${body.message ?? response.statusText}`);
				}
			},
			onerror: () => toast('Could not reach cs-demo-cloud. Check the address and certificate.'),
			ontimeout: () => toast('cs-demo-cloud took too long to answer')
		});
	}

	function showButton() {
		if (button || !document.body) return;
		button = document.createElement('button');
		button.textContent = '⇪ Send demo to cs-demo-cloud';
		Object.assign(button.style, {
			position: 'fixed',
			right: '16px',
			bottom: '16px',
			zIndex: 2147483647,
			padding: '10px 14px',
			border: '0',
			borderRadius: '8px',
			background: '#ff5500',
			color: '#fff',
			font: '600 13px system-ui, sans-serif',
			cursor: 'pointer'
		});
		button.addEventListener('click', () => lastDemo && sendBest(lastDemo));
		document.body.append(button);
	}

	const isSigned = (url) => new URL(url).search.length > 1;

	function found(url) {
		if (!demoLink.test(url) || seen.has(url)) return;
		seen.add(url);
		if (lastDemo && isSigned(lastDemo) && !isSigned(url)) return;
		lastDemo = url;
		if (document.body) showButton();
		else addEventListener('DOMContentLoaded', showButton, { once: true });
	}

	function scan(value, depth = 0) {
		if (depth > 6 || value == null) return;
		if (typeof value === 'string') found(value);
		else if (Array.isArray(value)) value.forEach((item) => scan(item, depth + 1));
		else if (typeof value === 'object') Object.values(value).forEach((item) => scan(item, depth + 1));
	}

	const page = unsafeWindow;
	const originalFetch = page.fetch;
	page.fetch = async function (...args) {
		const response = await originalFetch.apply(this, args);
		if ((response.headers.get('content-type') ?? '').includes('json')) {
			response.clone().json().then(scan, () => {});
		}
		return response;
	};

	const originalXhrOpen = page.XMLHttpRequest.prototype.open;
	page.XMLHttpRequest.prototype.open = function (...args) {
		this.addEventListener('load', () => {
			if (!(this.getResponseHeader('content-type') ?? '').includes('json')) return;
			try {
				scan(typeof this.response === 'string' ? JSON.parse(this.response) : this.response);
			} catch {}
		});
		return originalXhrOpen.apply(this, args);
	};

	const originalOpen = page.open;
	page.open = function (url, ...rest) {
		if (typeof url === 'string') found(new URL(url, location.href).href);
		return originalOpen.call(this, url, ...rest);
	};

	document.addEventListener(
		'click',
		(event) => {
			const anchor = event.target instanceof Element && event.target.closest('a[href]');
			if (anchor) found(anchor.href);
		},
		true
	);

	addEventListener('DOMContentLoaded', () => {
		for (const anchor of document.querySelectorAll('a[href]')) found(anchor.href);
	});
})();
