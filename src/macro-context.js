import MapSyntaxReducer from "./map-syntax-reducer";
import reducer from "shift-reducer";
import { expect } from './errors';
import { List } from 'immutable';
import { Enforester } from './enforester';
import Syntax, { ALL_PHASES } from './syntax';
import * as _ from 'ramda';
import { Maybe } from 'ramda-fantasy';
const Just = Maybe.Just;
const Nothing = Maybe.Nothing;


const symWrap = Symbol('wrapper');
const privateData = new WeakMap();

const getVal = t => {
  if (t.match("delimiter")) {
    return null;
  }
  if (typeof t.val === 'function') {
    return t.val();
  }
  return null;
};

export class SyntaxOrTermWrapper {
  constructor(s, context = {}) {
    this[symWrap] = s;
    this.context = context;
  }

  from(type, value) {
    let stx = this[symWrap];
    if (typeof stx.from === 'function') {
      return stx.from(type, value);
    }
  }
  fromNull() {
    return this.from("null", null);
  }

  fromNumber(value) {
    return this.from('number', value);
  }

  fromString(value) {
    return this.from("string", value);
  }

  fromPunctuator(value) {
    return this.from("punctuator", value);
  }

  fromKeyword(value) {
    return this.from("keyword");
  }

  fromIdentifier(value) {
    return this.from("identifier", value);
  }

  fromRegularExpression(value) {
    return this.from("regularExpression", value);
  }

  fromBraces(inner) {
    return this.from("braces", inner);
  }

  fromBrackets(inner) {
    return this.from("brackets", inner);
  }

  fromParens(inner) {
    return this.from("parens", inner);
  }

  match(type, value) {
    let stx = this[symWrap];
    if (typeof stx.match === 'function') {
      return stx.match(type, value);
    }
  }

  isIdentifier(value) {
    return this.match("identifier", value);
  }

  isAssign(value) {
    return this.match("assign", value);
  }

  isBooleanLiteral(value) {
    return this.match("boolean", value);
  }

  isKeyword(value) {
    return this.match("keyword", value);
  }

  isNullLiteral(value) {
    return this.match("null", value);
  }

  isNumericLiteral(value) {
    return this.match("number", value);
  }

  isPunctuator(value) {
    return this.match("punctuator", value);
  }

  isStringLiteral(value) {
    return this.match("string", value);
  }

  isRegularExpression(value) {
    return this.match("regularExpression", value);
  }

  isTemplate(value) {
    return this.match("template", value);
  }

  isDelimiter(value) {
    return this.match("delimiter", value);
  }

  isParens(value) {
    return this.match("parens", value);
  }

  isBraces(value) {
    return this.match("braces", value);
  }

  isBrackets(value) {
    return this.match("brackets", value);
  }

  isSyntaxTemplate(value) {
    return this.match("syntaxTemplate", value);
  }

  isEOF(value) {
    return this.match("eof", value);
  }

  lineNumber() {
    return this[symWrap].lineNumber();
  }

  val() {
    return getVal(this[symWrap]);
  }

  inner() {
    let stx = this[symWrap];
    if (!stx.match("delimiter")) {
      throw new Error('Can only get inner syntax on a delimiter');
    }

    let enf = new Enforester(stx.inner(), List(), this.context);
    return new MacroContext(enf, 'inner', this.context);
  }
}

export function unwrap(x) {
  if (x instanceof SyntaxOrTermWrapper) {
    return x[symWrap];
  }
  return x;
}

/*
ctx :: {
  of: (Syntax) -> ctx
  next: (String) -> Syntax or Term
}
*/
export default class MacroContext {
  constructor(enf, name, context, useScope, introducedScope) {
    const priv = {
      backup: enf,
      name,
      context
    };

    if (useScope && introducedScope) {
      priv.noScopes = false;
      priv.useScope = useScope;
      priv.introducedScope = introducedScope;
    } else {
      priv.noScopes = true;
    }
    privateData.set(this, priv);
    this.reset(); // instantiate enforester

    this[Symbol.iterator] = () => this;
  }

  name() {
    const { name, context } = privateData.get(this);
    return new SyntaxOrTermWrapper(name, context);
  }

  expand(type) {
    const { enf, context } = privateData.get(this);
    if (enf.rest.size === 0) {
      return {
        done: true,
        value: null
      };
    }
    enf.expandMacro();
    let originalRest = enf.rest;
    let value;
    switch(type) {
      case 'AssignmentExpression':
      case 'expr':
        value = enf.enforestExpressionLoop();
        break;
      case 'Expression':
        value = enf.enforestExpression();
        break;
      case 'Statement':
      case 'stmt':
        value = enf.enforestStatement();
        break;
      case 'BlockStatement':
      case 'WhileStatement':
      case 'IfStatement':
      case 'ForStatement':
      case 'SwitchStatement':
      case 'BreakStatement':
      case 'ContinueStatement':
      case 'DebuggerStatement':
      case 'WithStatement':
      case 'TryStatement':
      case 'ThrowStatement':
      case 'ClassDeclaration':
      case 'FunctionDeclaration':
      case 'LabeledStatement':
      case 'VariableDeclarationStatement':
      case 'ReturnStatement':
      case 'ExpressionStatement':
        value = enf.enforestStatement();
        expect(_.whereEq({type}, value), `Expecting a ${type}`, value, originalRest);
        break;
      case 'YieldExpression':
        value = enf.enforestYieldExpression();
        break;
      case 'ClassExpression':
        value = enf.enforestClass({isExpr: true});
        break;
      case 'ArrowExpression':
        value = enf.enforestArrowExpression();
        break;
      case 'NewExpression':
        value = enf.enforestNewExpression();
        break;
      case 'ThisExpression':
      case 'FunctionExpression':
      case 'IdentifierExpression':
      case 'LiteralNumericExpression':
      case 'LiteralInfinityExpression':
      case 'LiteralStringExpression':
      case 'TemplateExpression':
      case 'LiteralBooleanExpression':
      case 'LiteralNullExpression':
      case 'LiteralRegExpExpression':
      case 'ObjectExpression':
      case 'ArrayExpression':
        value = enf.enforestPrimaryExpression();
        break;
      case 'UnaryExpression':
      case 'UpdateExpression':
      case 'BinaryExpression':
      case 'StaticMemberExpression':
      case 'ComputedMemberExpression':
      case 'AssignmentExpression':
      case 'CompoundAssignmentExpression':
      case 'ConditionalExpression':
        value = enf.enforestExpressionLoop();
        expect(_.whereEq({type}, value), `Expecting a ${type}`, value, originalRest);
        break;
      default:
        throw new Error('Unknown term type: ' + type);
    }
    return {
      done: false,
      value: new SyntaxOrTermWrapper(value, context)
    };
  }

  _rest(enf) {
    const priv = privateData.get(this);
    if(priv.backup === enf) {
      return priv.enf.rest;
    }
    throw Error("Unauthorized access!");
  }

  reset() {
    const priv = privateData.get(this);
    const { rest, prev, context } = priv.backup;
    priv.enf = new Enforester(rest, prev, context);
  }

  next() {
    const { enf, noScopes, useScope, introducedScope, context } = privateData.get(this);
    if (enf.rest.size === 0) {
      return {
        done: true,
        value: null
      };
    }
    let value = enf.advance();
    if (!noScopes) {
      value = value
        .addScope(useScope, context.bindings, ALL_PHASES)
        .addScope(introducedScope, context.bindings, ALL_PHASES, { flip: true });
    }
    return {
      done: false,
      value: new SyntaxOrTermWrapper(value, context)
    };
  }
}
