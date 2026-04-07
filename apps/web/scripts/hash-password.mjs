#!/usr/bin/env node
// Uso: node scripts/hash-password.mjs "minha_senha_aqui"
// Gera o hash bcrypt para colocar em ADMIN_PASSWORD_HASH no .env

import bcrypt from 'bcryptjs';

const password = process.argv[2];

if (!password) {
  console.error('Uso: node scripts/hash-password.mjs "<senha>"');
  process.exit(1);
}

const hash = bcrypt.hashSync(password, 10);
console.log(hash);
