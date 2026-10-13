import { createServer } from 'node:http';
import process from 'node:process';

const protocolHeader = (process.env.PROTOCOL_HEADER ||= 'x-forwarded-proto');
const hostHeader = (process.env.HOST_HEADER ||= 'x-forwarded-host');

const origin = process.env.ORIGIN ? new URL(process.env.ORIGIN) : null;
const { handler } = await import('./build/handler.js');

const server = createServer((req, res) => {
	if (origin) {
		req.headers[protocolHeader] = origin.protocol.slice(0, -1);
		req.headers[hostHeader] = origin.host;
	} else if (!req.headers[protocolHeader]) {
		req.headers[protocolHeader] = 'http';
	}
	handler(req, res, () => {
		res.statusCode = 404;
		res.end('Not found');
	});
});

const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || '0.0.0.0';
server.listen(port, host, () =>
	console.log(
		`Listening on ${origin ?? `http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`}`
	)
);

for (const signal of ['SIGINT', 'SIGTERM']) {
	process.once(signal, () => {
		server.close(() => process.exit(0));
		server.closeIdleConnections();
		setTimeout(() => process.exit(0), 10_000).unref();
	});
}
