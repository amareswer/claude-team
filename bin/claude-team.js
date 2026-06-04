#!/usr/bin/env node

import { createRequire } from "module";
import { fileURLToPath } from "url";
import path from "path";
import { program } from "../lib/cli.js";

program.parse(process.argv);