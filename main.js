import { Command, InvalidArgumentError } from 'commander';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import superagent from 'superagent';

const CAT_URL = 'https://http.cat';

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

// Відповідь із картинкою; source показує, звідки її взято
function sendImage(res, image, source) {
  res.writeHead(200, {
    'Content-Type': 'image/jpeg',
    'Content-Length': image.length,
    'X-Image-Source': source,
  });
  res.end(image);
}

// Повертає код зі шляху виду /200 або null, якщо шлях некоректний
function parseStatusCode(rawUrl) {
  const { pathname } = new URL(rawUrl, 'http://localhost');
  const match = /^\/(\d{3})$/.exec(pathname);
  return match ? match[1] : null;
}

// Шлях до файлу кешу для заданого коду
function cacheFilePath(code) {
  return path.join(cacheDir, `${code}.jpg`);
}

// Атомарний запис: спочатку тимчасовий файл, потім перейменування,
// тому в кеші ніколи не буде наполовину записаного файлу
async function writeCacheFile(filePath, data) {
  const tmpPath = `${filePath}.${randomUUID()}.tmp`;
  try {
    await writeFile(tmpPath, data);
    await rename(tmpPath, filePath);
  } catch (err) {
    try {
      await unlink(tmpPath);
    } catch {
      // тимчасового файлу може вже не бути
    }
    throw err;
  }
}

// Збирає тіло запиту цілком у Buffer через промісний інтерфейс потоку
async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function handleGet(code, req, res) {
  const filePath = cacheFilePath(code);

  // 1. Спроба взяти картинку з кешу
  let cached = null;
  try {
    cached = await readFile(filePath);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  if (cached) {
    return sendImage(res, cached, 'cache');
  }

  // 2. Промах кешу: запит до http.cat
  let image;
  try {
    const response = await superagent
      .get(`${CAT_URL}/${code}`)
      .buffer(true)
      .parse(superagent.parse.image)
      .timeout({ response: 5000, deadline: 15000 });
    image = response.body;
  } catch (err) {
    if (err.status) {
      return sendText(res, 404, `Картинку для коду ${code} не знайдено на http.cat (статус ${err.status})`);
    }
    return sendText(res, 404, `Не вдалося отримати картинку з http.cat: ${err.message}`);
  }

  if (!Buffer.isBuffer(image) || image.length === 0) {
    return sendText(res, 404, 'http.cat повернув порожню відповідь');
  }

  // 3. Спочатку зберігаємо в кеш, потім віддаємо клієнтові
  await writeCacheFile(filePath, image);
  return sendImage(res, image, 'http.cat');
}

async function handlePut(code, req, res) {
  const body = await readBody(req);

  if (body.length === 0) {
    return sendText(res, 400, 'Тіло запиту порожнє: передайте картинку в тілі PUT');
  }

  // Наявну картинку замінюємо, нової створюємо; байти зберігаються без змін
  await writeCacheFile(cacheFilePath(code), body);
  sendText(res, 201, `Картинку для коду ${code} збережено в кеш`);
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
