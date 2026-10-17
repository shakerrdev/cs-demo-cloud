import { createServer as createHttpServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { createServer as createNetServer } from 'node:net';
import process from 'node:process';
import { resolveDataDir } from '../../packages/shared/src/paths.ts';
import { createCertificates } from './tls.ts';

const protocolHeader = (process.env.PROTOCOL_HEADER ||= 'x-forwarded-proto');
const hostHeader = (process.env.HOST_HEADER ||= 'x-forwarded-host');

const origin = process.env.ORIGIN ? new URL(process.env.ORIGIN) : null;
const httpsSetting = (process.env.HTTPS ?? (origin ? 'off' : 'on')).toLowerCase();
const useHttps = !['off', 'false', '0', 'no'].includes(httpsSetting);

const certificates = useHttps ? await createCertificates(process.env, resolveDataDir()) : null;
process.env.TLS_MODE = certificates?.mode ?? 'off';
if (certificates?.mode === 'local-ca') process.env.TLS_CA_PATH = certificates.source.certPath;

const { handler } = await import('./build/handler.js');

function serve(req, res, protocol) {
	if (origin) {
		req.headers[protocolHeader] = origin.protocol.slice(0, -1);
		req.headers[hostHeader] = origin.host;
	} else if (protocol === 'https') {
		req.headers[protocolHeader] = 'https';
	} else if (!req.headers[protocolHeader]) {
		req.headers[protocolHeader] = 'http';
	}
	handler(req, res, () => {
		res.statusCode = 404;
		res.end('Not found');
	});
}

function servePlain(req, res) {
	const path = (req.url ?? '/').split('?')[0];
	if (!useHttps || origin || req.headers[protocolHeader] || /^\/healthz\/?$/.test(path)) {
		return serve(req, res, 'http');
	}
	const host = req.headers.host;
	if (!host) {
		res.statusCode = 400;
		return res.end('Missing Host header');
	}
	res.statusCode = 308;
	res.setHeader('location', `https://${host}${req.url ?? '/'}`);
	res.end();
}

const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || '0.0.0.0';
const plain = createHttpServer(servePlain);
const servers = [plain];
let listener = plain;

if (certificates) {
	const secure = createHttpsServer(
		{
			SNICallback: (servername, done) =>
				certificates.source.contextFor(servername).then(
					(context) => done(null, context),
					(error) => done(error)
				),
			...certificates.source.defaultPem()
		},
		(req, res) => serve(req, res, 'https')
	);
	secure.on('tlsClientError', () => {});
	setInterval(
		async () => {
			await certificates.source.defaultContext();
			secure.setSecureContext(certificates.source.defaultPem());
		},
		60 * 60 * 1000
	).unref();
	servers.push(secure);
	listener = createNetServer((socket) => {
		socket.once('error', () => socket.destroy());
		socket.once('data', (chunk) => {
			socket.pause();
			socket.unshift(chunk);
			(chunk[0] === 0x16 ? secure : plain).emit('connection', socket);
			process.nextTick(() => socket.resume());
		});
	});
}

listener.listen(port, host, () => {
	const shown = host === '0.0.0.0' ? 'localhost' : host;
	console.log(`Listening on ${origin ?? `${certificates ? 'https' : 'http'}://${shown}:${port}`}`);
	if (certificates?.mode === 'local-ca') {
		console.log(
			`HTTPS uses this server's own certificate authority (${certificates.source.certPath}). ` +
				'Install it once per device from Settings → HTTPS to get rid of the browser warning.'
		);
	}
});

for (const signal of ['SIGINT', 'SIGTERM']) {
	process.once(signal, () => {
		listener.close(() => process.exit(0));
		for (const server of servers) server.closeIdleConnections();
		setTimeout(() => process.exit(0), 10_000).unref();
	});
}
