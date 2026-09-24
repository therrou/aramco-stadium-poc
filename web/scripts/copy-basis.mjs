import { cpSync, mkdirSync } from "node:fs";
mkdirSync("public/basis", { recursive: true });
cpSync("node_modules/three/examples/jsm/libs/basis", "public/basis", { recursive: true });
