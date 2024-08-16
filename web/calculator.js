"use strict";

/** @enum {string} */ const _Kind = {
    numberLiteral: "number",
    opAdd: "add",
    opSubtract: "subtract",
    opMultiply: "multiply",
    opDivide: "divide",
    opPower: "power",
    identifier: "identifier",
    opAssign: "assign",
    openBracket: "openBracket",
    closeBracket: "closeBracket",
};

class CalculationException {
  constructor(/** string */ message) {
    /** @const */ this.message = message;
  }

  toString() {
    return this.message;
  }
}

class CalculationParseException extends CalculationException {
  constructor(/** string */ message, /** string?= */ buffer, /** number?= */ offset) {
    super(message);
    /** @const */ this.buffer = buffer;
    /** @const */ this.offset = offset;
  }
}

function newCalculationContext() {
  return new _DefaultCalculationContext();
}

/** @interface */
class CalculationContext {
  constructor() {}

  /** @return {_StackElement} */
  popStack() {}
  /** @return {void} */
  pushStack(/** !_StackElement */ newElement) {}

  /** @return {number?} */
  getRegister(/** string */ name) {}

  /** @return {void} */
  setRegister(/** string */ name, /** number */ value) {}
}

/**
 * @abstract
 * @implements {CalculationContext}
 */
class _StackCalculationContext {
  constructor() {
    /** @const {!Array<!_StackElement>} */ this._stack = [];
  }

  /** @return {_StackElement} */
  popStack() {
    return this._stack.pop() || null;
  }

  /** @return {void} */
  pushStack(/** !_StackElement */ newElement) {
    this._stack.push(newElement.bind(this));
  }
}

class _DefaultCalculationContext extends _StackCalculationContext {
  constructor() {
    super();
    /** @const {Map<string, number>} */ this._registers = new Map();
  }

  /** @return {number?} */
  getRegister(/** string */ name) {
    return this._registers.get(name);
  }

  /** @return {void} */
  setRegister(/** string */ name, /** number */ value) {
    this._registers.set(name, value);
  }

  /** @return {void} */
  mergeInto(/** !CalculationContext */ other) {
    for (let entry of this._registers.entries()) {
      other.setRegister(
        /** @type {string} */ (entry[0]),
        /** @type {number} */ (entry[1])
      );
    }
  }
}

class _OptimizationContext extends _StackCalculationContext {
  constructor() {
    super();
    /** @const {!Array<!_StackElement>} */ this._popped = [];
    /** {boolean} */ this._registerAccess = false;
  }

  /** @return {number?} */
  getRegister(/** string */ name) {
    this._registerAccess = true;
    return 1;
  }

  /** @return {void} */
  setRegister(/** string */ name, /** number */ value) {
    this._registerAccess = true;
  }

  /** @return {_StackElement} */
  popStack() {
    const result = super.popStack();
    if (result) this._popped.push(result);
    return result;
  }

  /** @return {void} */
  pushStack(/** !_StackElement */ newElement) {
    let elementToPush = newElement;
    if (this._registerAccess) {
      elementToPush = new _VariableReference("**unknown**", this);
      this._registerAccess = false;
    }
    this._popped.length = 0;
    super.pushStack(elementToPush);
  }

  /** @return {number} */
  get stackDepth() {
    return this._stack.length;
  }

  /** @return {boolean} */
  get stackIsNotEmpty() {
    return !!this._stack.length;
  }

  /** @return {boolean} */
  get topIsLiteral() {
    return this._top instanceof _Literal;
  }

  /** @return {number} */
  get topValue() {
    return this._top.value;
  }

  /** @return {!Array<!_StackElement>} */
  stackSince(/** number */ start) {
    return this._stack.slice(start);
  }

  get _top() {
    return this._stack[this._stack.length - 1];
  }
}

/** @abstract */
class _StackElement {
  /** @return {number} */ get value() {}
  set value(/** number */ val) {}
  /** @return {!_Opcode} */ toOpcode() {}

  /** @return {!_StackElement} */ bind(/** !CalculationContext */ context) {}
}

class _VariableReference extends _StackElement {
  constructor(name, context) {
    super();
    /** @const {string} */ this.name = name;
    /** @const {!CalculationContext} */ this.context = context;
  }

  /** @return {number} */ get value() {
    return this.context.getRegister(this.name) ?? 0;
  }

  set value(/** number */ val) {
    this.context.setRegister(this.name, val);
  }

  /** @return {!_Opcode} */ toOpcode() {
    const result = new _Opcode(_Kind.identifier);
    result.value = this.name;
    return result;
  }

  /** @return {!_VariableReference} */ bind(/** !CalculationContext */ context) {
    return new _VariableReference(this.name, this.context);
  }
}

class _Literal extends _StackElement {
  constructor(/** number */ value) {
    super();
    /** @const {number} */ this._value = value;
  }

  /** @return {number} */ get value() {
    return this._value;
  }

  set value(/** number */ _) {
    throw new CalculationException("You can't set a value to a literal");
  }

  /** @return {!_Opcode} */ toOpcode() {
    const result = new _Opcode(_Kind.numberLiteral);
    result.value = this._value;
    return result;
  }

  /** @return {!_Literal} */ bind(/** !CalculationContext */ context) {
    return this;
  }
}

/**
 * @typedef function(!_Opcode, !CalculationContext): void
 */
let _PerformOperation;
/**
 * @typedef function(!_Token): !_Opcode
 */
let _ToOpcode;

class _KindDefinition {
  constructor(/** !_Kind */ kind, /** string? */ symbol,
    /** _PerformOperation?= */ perform, /** _ToOpcode?= */ toOpcode) {
    this.kind = kind;
    this.symbol = symbol;
    this.perform = perform;
    this._toOpcodeOverride = toOpcode;
  }

  /** @return {!_Opcode} */ toOpcode(/** !_Token */ token) {
    if (this._toOpcodeOverride) return this._toOpcodeOverride(token);
    const result = new _Opcode(token.kind);
    result.value = token.value;
    return result;
  }
}

const /** Array<!_KindDefinition> */ _tokenDefinitions = [
  new _KindDefinition(_Kind.opAdd, "+", (op, /** !CalculationContext */ n) => {
    n.pushStack(new _Literal(n.popStack().value + n.popStack().value));
  }),
  new _KindDefinition(_Kind.opSubtract, "-", (op, /** !CalculationContext */ n) => {
    n.pushStack(new _Literal(-n.popStack().value + n.popStack().value));
  }),
  new _KindDefinition(_Kind.opMultiply, "*", (op, /** !CalculationContext */ n) => {
    n.pushStack(new _Literal(n.popStack().value * n.popStack().value));
  }),
  new _KindDefinition(_Kind.opDivide, "/", (op, /** !CalculationContext */ n) => {
    const a = n.popStack().value;
    const b = n.popStack().value;
    n.pushStack(new _Literal(b / a));
  }),
  new _KindDefinition(_Kind.opPower, "**", (op, /** !CalculationContext */ n) => {
    const right = n.popStack().value;
    const left = n.popStack().value;
    n.pushStack(new _Literal(left ** right));
  }),
  new _KindDefinition(
    _Kind.numberLiteral,
    null,
    (op, /** !CalculationContext */ n) => {
      n.pushStack(new _Literal(op.value));
    },
    (token) => {
      const result = new _Opcode(token.kind);
      result.value = +token.value;
      return result;
    }
  ),
  new _KindDefinition(_Kind.identifier, null, (op, /** !CalculationContext */ n) => {
    n.pushStack(new _VariableReference(op.value, n));
  }),
  new _KindDefinition(_Kind.opAssign, "=", (op, /** !CalculationContext */ n) => {
    const value = n.popStack().value;
    const target = /** @type {_VariableReference} */ (n.popStack());
    target.value = value;
    n.pushStack(new _Literal(value));
  }),
  new _KindDefinition(_Kind.openBracket, "("),
  new _KindDefinition(_Kind.closeBracket, ")"),
];
const /** Map<!_Kind, !_KindDefinition> */ _kindDefs = new Map(
  _tokenDefinitions.map((def) => [def.kind, def]),
);

const /** Map<string, !Array<!_KindDefinition>> */ _startCharacterTokens =
  Array.from(_kindDefs.values())
    .filter(entry => entry.symbol != null)
    .reduce((prev, current) => {
      const s = current.symbol[0];
      let a = prev.get(s);
      if (!a) prev.set(s, a = []);
      a.push(current);
      return prev;
    }, /** @type {Map<string, !Array<!_KindDefinition>>} */ (new Map()));

function /** string */ kindToString(/** !_Kind */ kind) {
  return kind.toString();
}

class _Kindful {
  constructor(/** !_Kind */ kind) {
    /** @const */ this._kind = kind;
  }

  /** @return {!_Kind} */ get kind() {
    return this._kind;
  }
}

class _Token extends _Kindful {
  constructor(/** !_Kind */ kind) {
    super(kind);
    /** @type {string|null} */ this.value = null;
  }

  toString() {
    return `${kindToString(this._kind)}(${this.value || ""})`;
  }

  /** @return {!_Opcode} */ toOpcode() {
    return _kindDefs.get(this._kind).toOpcode(this);
  }
}

class _Opcode extends _Kindful {
  constructor(/** !_Kind */ kind) {
    super(kind);
    /** @type {Object|string|number} */ this.value = null;
  }

  toString() {
    return `${kindToString(this._kind)}${this.value !== null ? " " : ""}${this.value ?? ""}`;
  }

  perform(/** !CalculationContext */ context) {
    _kindDefs.get(this._kind).perform(this, context);
  }
}

const /** Map<!_Kind, !RegExp> */ _patternTokens = new Map([
  [_Kind.numberLiteral, /(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y],
  [_Kind.identifier, /[_a-zA-Z][_a-zA-Z0-9]*/y],
]);

function /** _KindDefinition */ _findToken(/** Array<!_KindDefinition>?|undefined */ candidates,
  /** string */ buffer, /** number */ i) {
  if (!candidates) return null;
  let match = null;
  for (let def of candidates) {
    if (def.symbol && buffer.startsWith(def.symbol, i) &&
      (!match || match.symbol.length < def.symbol.length)) {
      match = def;
    }
  }
  return match;
}

function* /** !Iterable<!_Token> */ _tokenize(/** string */ buffer) {
  const l = buffer.length;
  for (let i = 0; i < l; ++i) {
    const c = buffer[i];
    if (c === " ") continue;
    const candidates = _startCharacterTokens.get(c);
    const single = _findToken(candidates, buffer, i);
    if (!single) {
      let found = false;
      for (let k of _patternTokens.keys()) {
        const re = _patternTokens.get(k);
        re.lastIndex = i;
        let m = re.exec(buffer);
        if (m) {
          found = true;
          const match = m[0];
          const token = new _Token(k);
          token.value = match;
          yield token;
          i += match.length - 1;
          break;
        }
      }
      if (!found) {
        throw new CalculationParseException(
          `Found a strange character in the source at ${i}: ${buffer[i]}`,
          buffer,
          i
        );
      }
    } else {
      yield new _Token(single.kind);
      i += single.symbol.length - 1;
    }
  }
}

function /** number */ _valueExpression(
  /** !Array<!_Opcode> */ ops,
  /** !Array<!_Token> */ tokens,
  /** number */ cursor) {
  let currentCursor = cursor;
  const current = tokens[currentCursor];
  if (current.kind === _Kind.openBracket) {
    currentCursor = _expression.expression(ops, tokens, currentCursor + 1);
    if (tokens[currentCursor].kind != _Kind.closeBracket) {
      throw new CalculationParseException("Ouch, no closing bracket");
    }
  } else if (current.kind === _Kind.identifier) {
    ops.push(current.toOpcode());
  } else {
    if (current.kind === _Kind.opSubtract) ++currentCursor;
    // assert(tokens[currentCursor].kind === _Kind.numberLiteral);
    current.value = `${current.kind == _Kind.opSubtract ? '-' : ''}${tokens[currentCursor].value}`;
    ops.push(current.toOpcode());
  }
  return currentCursor + 1;
}

class _PrecedenceGroup {
  constructor(/** !Iterable<!_Kind> */ kinds, /** _PrecedenceGroup?= */ parent) {
    /** @const {_PrecedenceGroup} */ this.parent = parent || null;
    /** @const */ this.kinds = new Set(kinds);
  }

  /** @return {number} */ halfExpression(
    /** !Array<!_Opcode> */ ops,
    /** !Array<!_Token> */ tokens,
    /** number */ cursor) {
    let /** _Token */ opToken = null;
    if (this.kinds.has(tokens[cursor].kind)) {
      // E => E + T
      opToken = tokens[cursor];
      return this.expression(ops, tokens, cursor + 1, opToken);
    } else {
      // this is not an expression, E => T
      return cursor;
    }
  }

  /** @return {number} */ expression(
    /** !Array<!_Opcode> */ ops,
    /** !Array<!_Token> */ tokens,
    /** number */ cursor,
    /** _Token?= */ lastTokenOp
  ) {
    const afterTerm = this.parent
        ? this.parent.expression(ops, tokens, cursor)
        : _valueExpression(ops, tokens, cursor);
    if (lastTokenOp) ops.push(lastTokenOp.toOpcode());
    if (afterTerm < tokens.length) {
      return this.halfExpression(ops, tokens, afterTerm);
    }
    return afterTerm;
  }

  /** @return {!_PrecedenceGroup} */ over(/** !Iterable<!_Kind> */ kinds) {
    return new _PrecedenceGroup(kinds, this);
  }
}

const _expression = new _PrecedenceGroup([_Kind.opPower])
    .over([_Kind.opMultiply, _Kind.opDivide])
    .over([_Kind.opAdd, _Kind.opSubtract])
    .over([_Kind.opAssign]);

function /** number */ _parseTokens(
  /** !Array<!_Opcode> */ ops,
  /** !Array<!_Token> */ tokens,
  /** number */ cursor) {
  return _expression.expression(ops, tokens, cursor);
}

class Program {
  /// Creates a program by parsing a source expression.
  constructor(/** string|!Array<!_Opcode> */ source) {
    /** @const {!Array<!_Opcode>} */ this._ops = typeof source === "string" ? [] : Array.from(source);
    if (typeof source === "string") {
      _parseTokens(this._ops, Array.from(_tokenize(source)), 0);
    }
  }

  /// Executes the program in the given calculaton context.
  /** @return {number} */ execute(/** CalculationContext?= */ context) {
    const realContext = context || newCalculationContext();
    for (let op of this._ops) {
      op.perform(realContext);
    }
    return realContext.popStack().value;
  }

  /// Returns an optimized version of the program if possible.
  /// Tries to calculate as much as it can in advance.
  /** @return {!Program} */ optimize() {
    const context = new _OptimizationContext();
    // new, optimized opcodes
    const /** !Array<!_Opcode> */ newOps = [];
    // the bound to which we have already added the opcodes
    // we don't automatically add opcodes for contextfree calculations,
    // only when needed, but we need to save where we have to
    // build the stack when we do have to
    let stackBound = 0;
    // we save the stack from the last written opcode before the operation,
    // so if the operation taints the stack, we emit this, and emit the
    // opcode that tainted the stack
    let /** Array<!_StackElement> */ stackSave = null;
    for (let op of this._ops) {
      if (context.stackIsNotEmpty && context.topIsLiteral) {
        stackSave = context.stackSince(stackBound);
      } else {
        stackSave = null;
      }
      op.perform(context);
      if (!context.topIsLiteral) {
        // the expression has referred to a variable
        if (stackSave != null && stackSave.isNotEmpty) {
          // since we added the last opcode, these entries were added to the
          // stack
          newOps.push(...stackSave.map((e) => e.toOpcode()));
        }
        newOps.push(op);
        stackBound = context.stackDepth;
      }
    }
    if (context.topIsLiteral) {
      // the expression refers to no variable
      const result = new _Opcode(_Kind.numberLiteral);
      result.value = context.topValue;
      return new Program([result]);
    }
    if (newOps.length < this._ops.length) return new Program(newOps);
    // could not optimize
    return this;
  }

  /** @return {number} */ get numOpcodes() {
    return this._ops.length;
  }

  /// Provides a string representation of the program by listing
  /// the opcodes seperated by newlines.
  toString() {
    return this._ops.join("\n");
  }
}

function newProgram(source) {
  return new Program(source);
}

const context = newCalculationContext();

const results = document.querySelector("#results");
const inputLine = document.querySelector("#inputLine");

function selectTargetContents(event) {
  const r = document.createRange();
  r.selectNodeContents(event.currentTarget);
  const s = window.getSelection();
  s.removeAllRanges();
  s.addRange(r);
}

function div(text) {
  const result = document.createElement("div");
  result.textContent = String(text);
  result.addEventListener("click", selectTargetContents);
  return result;
}

inputLine.addEventListener("keydown", e => {
  if (e.key === "Enter") {
    const expression = e.currentTarget.value;
    const d = div(expression);
    d.classList.add("q");
    const prog = newProgram(expression);
    console.log(prog.toString());
    const result = prog.execute(context);
    context.setRegister("last", result);
    const r = div(result);
    r.classList.add("a");
    results.append(d, r);
    e.currentTarget.select();
  }
});
