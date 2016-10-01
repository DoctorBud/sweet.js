// @flow
import Term, * as S from 'sweet-spec';
import { List } from 'immutable';
import {  Enforester } from "./enforester";
import TermExpander from "./term-expander.js";
import Env from "./env";
import * as _ from "ramda";
import * as T from "./terms";
import { gensym } from './symbol';
import { VarBindingTransform, CompiletimeTransform } from './transforms';
import {  assert } from "./errors";
import { evalCompiletimeValue } from './load-syntax';
import {  freshScope } from "./scope";
import { ALL_PHASES } from './syntax';
import ASTDispatcher from './ast-dispatcher';
import { collectBindings } from './hygiene-utils';
import Syntax from './syntax.js';

class RegisterBindingsReducer extends Term.CloneReducer {
  useScope: any;
  phase: number;
  bindings: any;
  skipDup: boolean;
  env: Env;

  constructor(useScope: any, phase: number, skipDup: boolean, bindings: any, env: Env) {
    super();
    this.useScope = useScope;
    this.phase = phase;
    this.bindings = bindings;
    this.skipDup = skipDup;
    this.env = env;
  }

  reduceBindingIdentifier(t: Term, s: { name: Syntax }) {
    let newName = s.name.removeScope(this.useScope, this.phase);
    let newBinding = gensym(newName.val());
    this.bindings.add(newName, {
      binding: newBinding,
      phase: this.phase,
      skipDup: this.skipDup
    });
    this.env.set(newBinding.toString(), new VarBindingTransform(newName));
    return t.extend({
      name: newName
    });
  }
}

class RegisterSyntaxBindingsReducer extends Term.CloneReducer {
  useScope: any;
  phase: number;
  bindings: any;
  env: Env;
  val: any;

  constructor(useScope: any, phase: number, bindings: any, env: Env, val: any) {
    super();
    this.useScope = useScope;
    this.phase = phase;
    this.bindings = bindings;
    this.env = env;
    this.val = val;
  }

  reduceBindingIdentifier(t: Term, s: { name: Syntax }) {
    let newName = s.name.removeScope(this.useScope, this.phase);
    let newBinding = gensym(newName.val());
    this.bindings.add(newName, {
      binding: newBinding,
      phase: this.phase,
      skipDup: false
    });
    let resolvedName = newName.resolve(this.phase);
    this.env.set(resolvedName, new CompiletimeTransform(this.val));
    return t.extend({
      name: newName
    });
  }
}

function bindImports(impTerm, exModule, context) {
  let names = [];
  let phase = impTerm.forSyntax ? context.phase + 1 : context.phase;
  impTerm.namedImports.forEach(specifier => {
    let name = specifier.binding.name;
    let exportName = findNameInExports(name, exModule.exportEntries);
    if (exportName != null) {
      let newBinding = gensym(name.val());
      context.store.set(newBinding.toString(), new VarBindingTransform(name));
      context.bindings.addForward(name, exportName, newBinding, phase);
      names.push(name);
    }
  });
  return List(names);
}


function findNameInExports(name, exp) {
  let foundNames = exp.reduce((acc, e) => {
    if (T.isExportFrom(e)) {
      return acc.concat(e.namedExports.reduce((acc, specifier) => {
        if (specifier.exportedName.val() === name.val()) {
          return acc.concat(specifier.exportedName);
        }
        return acc;
      }, List()));
    } else if (T.isExport(e)) {
      return acc.concat(e.declaration.declarators.reduce((acc, decl) => {
        if (decl.binding.name.val() === name.val()) {
          return acc.concat(decl.binding.name);
        }
        return acc;
      }, List()));
    }
    return acc;
  }, List());
  assert(foundNames.size <= 1, 'expecting no more than 1 matching name in exports');
  return foundNames.get(0);
}

function removeNames(impTerm, names) {
  let namedImports = impTerm.namedImports.filter(specifier => !names.contains(specifier.binding.name));
  return impTerm.extend({ namedImports });
}

// function bindAllSyntaxExports(exModule, toSynth, context) {
//   let phase = context.phase;
//   exModule.exportEntries.forEach(ex => {
//     if (isExportSyntax(ex)) {
//       ex.declaration.declarators.forEach(decl => {
//         let name = decl.binding.name;
//         let newBinding = gensym(name.val());
//         let storeName = exModule.moduleSpecifier + ":" + name.val() + ":" + phase;
//         let synthStx = Syntax.fromIdentifier(name.val(), toSynth);
//         let storeStx = Syntax.fromIdentifier(storeName, toSynth);
//         context.bindings.addForward(synthStx, storeStx, newBinding, phase);
//       });
//     }
//   });
// }

export default class TokenExpander extends ASTDispatcher {
  constructor(context: any) {
    super('expand', false);
    this.context = context;
  }

  expand(stxl: List<Syntax>) {
    let result = [];
    if (stxl.size === 0) {
      return List(result);
    }
    let prev = List();
    let enf = new Enforester(stxl, prev, this.context);

    while (!enf.done) {
      result.push(this.dispatch(enf.enforest()));
    }

    return List(result);
  }

  expandVariableDeclarationStatement(term: S.VariableDeclarationStatement) {
    return term.extend({
      declaration: this.registerVariableDeclaration(term.declaration)
    });
  }

  expandFunctionDeclaration(term) {
    return this.registerFunctionOrClass(term);
  }

  // TODO: think about function expressions

  expandImport(term) {
    let path = term.moduleSpecifier.val();
    let mod;
    if (term.forSyntax) {
      mod = this.context.modules.getAtPhase(path, this.context.phase + 1, this.context.cwd);
      this.context.store = this.context.modules.visit(mod, this.context.phase + 1, this.context.store);
      this.context.store = this.context.modules.invoke(mod, this.context.phase + 1, this.context.store);
    } else {
      mod = this.context.modules.getAtPhase(path, this.context.phase, this.context.cwd);
      this.context.store = this.context.modules.visit(mod, this.context.phase, this.context.store);
    }
    let boundNames = bindImports(term, mod, this.context);
    return removeNames(term, boundNames);
  }

  expandExport(term) {
    if (T.isFunctionDeclaration(term.declaration) || T.isClassDeclaration(term.declaration)) {
      return term.extend({
        declaration: this.registerFunctionOrClass(term.declaration)
      });
    } else if (T.isVariableDeclaration(term.declaration)) {
      return term.extend({
        declaration: this.registerVariableDeclaration(term.declaration)
      });
    }
    return term;
  }

  // [isPragma, term => {
  //   let pathStx = term.items.get(0);
  //   if (pathStx.val() === 'base') {
  //     return term;
  //   }
  //   let mod = this.context.modules.loadAndCompile(pathStx.val());
  //   store = this.context.modules.visit(mod, phase, store);
  //   bindAllSyntaxExports(mod, pathStx, this.context);
  //   return term;
  // }],


  registerFunctionOrClass(term) {
    let red = new RegisterBindingsReducer(
      this.context.useScope,
      this.context.phase,
      false,
      this.context.bindings,
      this.context.env
    );
    return term.extend({
      name: term.name.reduce(red)
    });
  }

  registerVariableDeclaration(term) {
    if (term.kind === 'syntax' || term.kind === 'syntaxrec') {
      return this.registerSyntaxDeclaration(term);
    }
    let red = new RegisterBindingsReducer(
      this.context.useScope,
      this.context.phase,
      term.kind === 'var',
      this.context.bindings,
      this.context.env
    );
    return term.extend({
      declarators: term.declarators.map(decl => {
        return decl.extend({
          binding: decl.binding.reduce(red)
        })
      })
    });
  }

  registerSyntaxDeclaration(term) {
    if (term.kind === 'syntax') {
      // syntax id^{a, b} = <init>^{a, b}
      // ->
      // syntaxrec id^{a,b,c} = function() { return <<id^{a}>> }
      // syntaxrec id^{a,b} = <init>^{a,b,c}
      let scope = freshScope('nonrec');
      term = term.extend({
        declarators: term.declarators.map(decl => {
          let name = decl.binding.name;
          let nameAdded = name.addScope(scope, this.context.bindings, ALL_PHASES);
          let nameRemoved = name.removeScope(this.context.currentScope[this.context.currentScope.length - 1], this.context.phase);
          let newBinding = gensym(name.val());
          this.context.bindings.addForward(nameAdded, nameRemoved, newBinding, this.context.phase);
          return decl.extend({
            init: decl.init.addScope(scope, this.context.bindings, ALL_PHASES)
          });
        })
      });
    }
    // for syntax declarations we need to load the compiletime value
    // into the environment
    return term.extend({
      declarators: term.declarators.map(decl => {
        // each compiletime value needs to be expanded with a fresh
        // environment and in the next higher phase
        let syntaxExpander = new TermExpander(_.merge(this.context, {
          phase: this.context.phase + 1,
          env: new Env(),
          store: this.context.store
        }));
        let init = syntaxExpander.expand(decl.init);
        let val = evalCompiletimeValue(init, _.merge(this.context, {
          phase: this.context.phase + 1
        }));
        let red = new RegisterSyntaxBindingsReducer(
          this.context.useScope,
          this.context.phase,
          this.context.bindings,
          this.context.env,
          val);
        return decl.extend({ binding: decl.binding.reduce(red), init });
      })
    });
  }

  // registerSyntaxDeclarator(term) {
  //
  // }
}
