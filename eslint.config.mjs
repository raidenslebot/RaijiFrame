import base from "file:///C:/Users/Administrator/AppData/Roaming/npm/node_modules/.global-eslint/eslint.config.mjs";

export default [
  ...base,
  { ignores: ["dist/**", "release/**", "node_modules/**"] },
];
