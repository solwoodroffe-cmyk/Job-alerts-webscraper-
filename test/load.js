// Loads src/Parse.js into a sandbox so its pure functions can be tested in Node.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const code = fs.readFileSync(path.join(__dirname, '..', 'src', 'Parse.js'), 'utf8');
const exportsList = ['wordRe_', 'titleMatches_', 'detectState_', 'htmlToLines_', 'decode_', 'feedUrl_', 'parseFeed_'];
const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(code + '\n;globalThis.__x = {' + exportsList.join(',') + ', RELEVANT, NOISE};', sandbox);
module.exports = sandbox.__x;
