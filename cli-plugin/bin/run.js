#!/usr/bin/env node
// Runs the plugin's commands standalone (without the b2c CLI), e.g.:
//   node bin/run.js audit code --dir ./cartridges
import {execute} from '@oclif/core';

await execute({dir: import.meta.url});
