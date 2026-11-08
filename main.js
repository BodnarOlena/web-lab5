import { Command, InvalidArgumentError } from 'commander';
import { once } from 'node:events';
import { mkdir } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';

// Перетворює рядок порту на число й відхиляє некоректні значення
function parsePort(value) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new InvalidArgumentError('порт має бути цілим числом від 0 до 65535');
  }
  return port;
}

const program = new Command();

program
  .helpOption('--help', 'показати довідку')
  .requiredOption('-h, --host <address>', 'адреса, на якій працює сервер')
  .requiredOption('-p, --port <number>', 'порт сервера', parsePort)
  .requiredOption('-c, --cache <path>', 'шлях до теки з кешованими картинками');

program.parse();
const options = program.opts();

// Тека кешу створюється до початку приймання запитів
const cacheDir = path.resolve(options.cache);

try {
  await mkdir(cacheDir, { recursive: true });
} catch (err) {
  console.error(`Не вдалося створити теку кешу "${cacheDir}": ${err.message}`);
  process.exit(1);
}

// Відповідь із текстовим повідомленням
function sendText(res, status, message, headers = {}) {
  res.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    ...headers,
  });
  res.end(`${message}\n`);
}

// Повертає код зі шляху виду /200 або null, якщо шлях некоректний
function parseStatusCode(rawUrl) {
  const { pathname } = new URL(rawUrl, 'http://localhost');
  const match = /^\/(\d{3})$/.exec(pathname);
  return match ? match[1] : null;
}

// Заглушки: кожен метод буде реалізовано окремим комітом
async function handleGet(code, req, res) {
  sendText(res, 501, 'GET ще не реалізовано');
}

async function handlePut(code, req, res) {
  sendText(res, 501, 'PUT ще не реалізовано');
}

async function handleDelete(code, req, res) {
  sendText(res, 501, 'DELETE ще не реалізовано');
}

const handlers = new Map([
  ['GET', handleGet],
  ['PUT', handlePut],
  ['DELETE', handleDelete],
]);

// Єдиний дозволений колбек: обробник запиту
const server = http.createServer(async (req, res) => {
  try {
    const handler = handlers.get(req.method);
    if (!handler) {
      return sendText(res, 405, `Метод ${req.method} не дозволено`, {
        Allow: [...handlers.keys()].join(', '),
      });
    }

    const code = parseStatusCode(req.url);
    if (code === null) {
      return sendText(res, 404, 'Not Found: шлях має вигляд /<код стану>, наприклад /404');
    }

    await handler(code, req, res);
  } catch (err) {
    console.error(err);
    if (!res.headersSent) {
      sendText(res, 500, 'Внутрішня помилка сервера');
    } else {
      res.end();
    }
  }
});

// once() із events повертає проміс, тож колбеки для listen не потрібні
server.listen(options.port, options.host);
try {
  await once(server, 'listening');
} catch (err) {
  console.error(`Не вдалося запустити сервер: ${err.message}`);
  process.exit(1);
}

console.log(`Проксі-сервер: http://${options.host}:${options.port}, кеш: ${cacheDir}`);
