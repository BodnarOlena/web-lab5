import { Command, InvalidArgumentError } from 'commander';
import { mkdir } from 'node:fs/promises';
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

console.log(`Хост: ${options.host}, порт: ${options.port}, кеш: ${cacheDir}`);