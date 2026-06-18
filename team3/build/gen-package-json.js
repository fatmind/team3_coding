#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const webPkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'web', 'package.json'), 'utf-8'));

const pkg = {
  name: 'team3',
  version: webPkg.version || '0.1.0',
  description: 'Team3 — Human × Agent collaboration tool',
  bin: {
    team3: './bin/team3.js',
  },
  engines: {
    node: '>=20.0.0',
  },
  files: [
    'bin/',
    'server/',
    'daemon.min.js',
    'assets/',
  ],
};

process.stdout.write(JSON.stringify(pkg, null, 2) + '\n');
