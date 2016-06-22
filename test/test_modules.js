import { parse, expand } from "../src/sweet";
import expect from "expect.js";
import { expr, stmt, items, testEval } from "./assertions";
import test from 'ava';

test('should load a simple syntax transformer', () => {
  let loader = {
    "./m.js": `#lang "sweet.js";
    export syntax m = function (ctx) {
      return syntaxQuote\`1\`;
    }`
  };
  testEval(`import { m } from "./m.js";
  output = m`, 1, loader);
});

test('importing for syntax with a single number exported', () => {
  let loader = {
    './num.js': `
      #lang 'base';
      export var n = 1;
    `
  };

  testEval(`
    import { n } from './num.js' for syntax;

    syntax m = function (ctx) {
      if (n === 1) {
        return #\`true\`;
      }
      return #\`false\`;
    }
    output = m;
  `, true, loader);
});

test('import for syntax; export var; function', () => {
  let loader = {
    './id.js': `
      #lang 'base';
      export var id = function (x) {
        return x;
      }
    `
  };
  testEval(`
    import { id } from './id.js' for syntax;

    syntax m = ctx => {
      return id(#\`1\`);
    }
    output = m;
  `, 1, loader);
});

test('import for syntax; export declaration; function', () => {
  let loader = {
    './id.js': `
      #lang 'base';
      export function id(x) {
        return x;
      }
    `
  };
  testEval(`
    import { id } from './id.js' for syntax;

    syntax m = ctx => {
      return id(#\`1\`);
    }
    output = m;
  `, 1, loader);
});


test('importing a macro for syntax', () => {
  let loader = {
    './id.js': `
      #lang 'base';
      export syntax m = function (ctx) {
        return #\`1\`;
      }
    `
  };
  testEval(`
    import { m } from './id.js' for syntax;

    syntax m = ctx => {
      let x = m;
      return #\`1\`;
    }
    output = m;
  `, 1, loader);
});

test('importing a macro for syntax only binds what is named', () => {
  let loader = {
    './id.js': `
      #lang 'base';
      syntax n = ctx => #\`2\`;

      export syntax m = function (ctx) {
        return #\`1\`;
      }

    `
  };
  testEval(`
    import { m } from './id.js' for syntax;

    syntax test = ctx => {
      if (typeof n !== 'undefined' && n === 2) {
        throw new Error('un-exported and un-imported syntax should not be bound');
      }
      return #\`1\`;
    }
    output = test;
  `, 1, loader);
});
//
// test('importing a chain for syntax works', t => {
//   let loader = {
//     'b': `#lang 'sweet.js';
//       export function b(x) { return x; }
//     `,
//     'a': `#lang 'sweet.js';
//       import { b } from 'b' for syntax;
//
//       export function a() {
//         return b(1);
//       }
//     `
//   };
//
//   testEval(`#lang 'sweet.js';
//     import { a } from 'a' for syntax;
//     syntax m = ctx => {
//       if (a() !== 1) {
//         throw new Error('un expected something or rather');
//       }
//       return #\`1\`;
//     }
//     output = m
//   `, 1, loader);
// });
