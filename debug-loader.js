'use strict';
/*
This file makes debugging sweet.js easier. Uses the built version of sweet.js
to compile "test.js". You can use node-inspector to step through the expansion
process:

	npm install -g node-inspector
	node-debug debug.js
*/

var compile = require("./build/src/sweet-loader.js").default;

let registry = {
  'foo': `42`
};

debugger;
compile('foo', registry).then(result => {
  console.log(result);
});