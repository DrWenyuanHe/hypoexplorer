import path from "node:path";
import ts from "@typescript/typescript6";

export function parseSource(name, text) {
  const source = ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true);
  if (source.parseDiagnostics.length) throw new Error(`Cannot parse ${name}: ${ts.flattenDiagnosticMessageText(source.parseDiagnostics[0].messageText, " ")}`);
  return source;
}

export const unwrap = (node) => {
  while (node && (ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isParenthesizedExpression(node))) node = node.expression;
  return node;
};

export function propertyName(node) {
  if (node && (ts.isIdentifier(node) || ts.isStringLiteral(node) || ts.isNumericLiteral(node))) return node.text;
  throw new Error("Expected a literal property name in the context source");
}

export function variables(source) {
  return new Map(source.statements.filter(ts.isVariableStatement).flatMap((statement) =>
    statement.declarationList.declarations.map((declaration) => [declaration.name.getText(source), unwrap(declaration.initializer)])));
}

// Evaluate only literal declarations and named imports. Never execute app code
// (which may initialize Supabase or browser APIs) just to describe a manifest.
export function literalReader(snapshot) {
  const cache = new Map();
  function file(name) {
    if (!cache.has(name)) cache.set(name, parseSource(name, snapshot.read(name)));
    return cache.get(name);
  }
  function value(name, node, stack = []) {
    node = unwrap(node);
    if (!node) throw new Error(`Missing literal in ${name}`);
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
    if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
    if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
    if (ts.isArrayLiteralExpression(node)) return node.elements.map((element) => value(name, element, stack));
    if (ts.isObjectLiteralExpression(node)) return Object.fromEntries(node.properties.map((property) => {
      if (!ts.isPropertyAssignment(property)) throw new Error(`Unsupported literal object in ${name}`);
      return [propertyName(property.name), value(name, property.initializer, stack)];
    }));
    if (ts.isIdentifier(node)) return constant(name, node.text, stack);
    throw new Error(`Unsupported context literal in ${name}: ${node.getText(file(name)).slice(0, 80)}`);
  }
  function constant(name, symbol, stack = []) {
    const key = `${name}:${symbol}`;
    if (stack.includes(key)) throw new Error(`Circular context constant: ${key}`);
    const next = [...stack, key];
    const source = file(name);
    const declaration = variables(source).get(symbol);
    if (declaration) return value(name, declaration, next);
    for (const statement of source.statements.filter(ts.isImportDeclaration)) {
      const bindings = statement.importClause?.namedBindings;
      if (!bindings || !ts.isNamedImports(bindings)) continue;
      const binding = bindings.elements.find((element) => element.name.text === symbol);
      if (!binding) continue;
      const specifier = statement.moduleSpecifier.text;
      const base = specifier.startsWith("@/") ? `src/${specifier.slice(2)}` : path.posix.join(path.posix.dirname(name), specifier);
      const target = [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`].find((candidate) => snapshot.files.includes(candidate));
      if (!target) throw new Error(`Cannot resolve ${specifier} in ${name}`);
      return constant(target, binding.propertyName?.text ?? symbol, next);
    }
    throw new Error(`Missing context constant ${key}`);
  }
  return { file, value, constant };
}

export const DATASETS = 'src/data/datasets.ts';
export const CATEGORIES = 'src/data/datasetCategories.ts';
export const CONTRACTS = 'src/types/index.ts';

// This adapter describes declarations, not the result of executing factories.
// The reviewed metadata function remains an explicit pointer beside sidecars.
export function readStructure(snapshot) {
  const reader = literalReader(snapshot);
  const source = reader.file(DATASETS);
  const array = variables(source).get('DATASETS');
  if (!array || !ts.isArrayLiteralExpression(array)) throw new Error('DATASETS must be a static array');
  function rejectHiddenMutations(node) {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.expression.getText(source) === 'DATASETS' && !['find', 'filter', 'map', 'some', 'every', 'includes'].includes(node.expression.name.text)) {
      if (!ts.isExpressionStatement(node.parent) || node.parent.parent !== source) throw new Error('Unsupported nested DATASETS mutation');
    }
    if (ts.isBinaryExpression(node) && node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && node.operatorToken.kind <= ts.SyntaxKind.LastAssignment && /^DATASETS\b/.test(node.left.getText(source))) throw new Error('Unsupported DATASETS assignment');
    if ((ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) && /^DATASETS\b/.test(node.operand.getText(source))) throw new Error('Unsupported DATASETS update');
    ts.forEachChild(node, rejectHiddenMutations);
  }
  rejectHiddenMutations(source);
  const selected = ['id', 'name', 'category', 'organism', 'modality', 'citation'];
  const datasets = array.elements.map((entry) => {
    if (!ts.isCallExpression(entry) || !['defineDataset', 'defineBulkStudy'].includes(entry.expression.getText(source)) || entry.arguments.length !== 1) throw new Error('Unsupported DATASETS entry; extend the static adapter');
    const object = unwrap(entry.arguments[0]);
    if (!ts.isObjectLiteralExpression(object) || object.properties.some((p) => !ts.isPropertyAssignment(p))) throw new Error('Dataset definitions must be literal objects');
    const fields = new Map(object.properties.map((p) => [propertyName(p.name), p.initializer]));
    if (fields.size !== object.properties.length) throw new Error('Duplicate dataset property');
    return { ...Object.fromEntries(selected.map((key) => [key, reader.value(DATASETS, fields.get(key))])), source: DATASETS };
  });
  // Recognize the repository's two sidecar registrations, including their
  // callback shape. A new registration style fails rather than losing entries.
  for (const statement of source.statements.filter(ts.isExpressionStatement)) {
    if (!/\bDATASETS\b/.test(statement.getText(source))) continue;
    const call = statement.expression;
    const fail = () => { throw new Error('Unsupported DATASETS mutation; extend the static adapter'); };
    if (!ts.isCallExpression(call) || call.expression.getText(source) !== 'DATASETS.push' || call.arguments.length !== 1 || !ts.isSpreadElement(call.arguments[0])) fail();
    const map = call.arguments[0].expression;
    if (!ts.isCallExpression(map) || !ts.isPropertyAccessExpression(map.expression) || map.expression.name.text !== 'map' || !ts.isIdentifier(map.expression.expression) || map.arguments.length !== 1) fail();
    const symbol = map.expression.expression.text;
    const callback = map.arguments[0];
    if (!ts.isArrowFunction(callback) || callback.parameters.length !== 1 || !ts.isIdentifier(callback.parameters[0].name)) fail();
    const param = callback.parameters[0].name.text;
    const body = unwrap(callback.body);
    if (!ts.isCallExpression(body) || body.expression.getText(source) !== 'defineDataset' || body.arguments.length !== 1) fail();
    let input = unwrap(body.arguments[0]), correction;
    if (ts.isCallExpression(input) && input.expression.getText(source) === 'reviewedStudyMetadata' && input.arguments.length === 1) {
      correction = 'src/data/reviewedStudyMetadata.ts';
      input = unwrap(input.arguments[0]);
    }
    // A unit-only relabel may wrap the record; it cannot change a selected field.
    if (ts.isCallExpression(input) && ts.isIdentifier(input.expression) && input.arguments.length === 1) {
      if (!isUnitOnlyRelabel(source, input.expression.text)) fail();
      input = unwrap(input.arguments[0]);
    }
    if (!ts.isIdentifier(input) || input.text !== param) fail();
    const declaration = source.statements.filter(ts.isImportDeclaration).find((s) => s.importClause?.name?.text === symbol);
    const specifier = declaration?.moduleSpecifier.text;
    if (!specifier?.startsWith('./') || !specifier.endsWith('.json')) fail();
    const filename = path.posix.join(path.posix.dirname(DATASETS), specifier);
    const records = JSON.parse(snapshot.read(filename));
    if (!Array.isArray(records)) throw new Error(`Expected dataset array: ${filename}`);
    const corrected = correction ? applyReviewedMetadata(reader, correction, records) : records;
    for (const record of corrected) datasets.push({ ...Object.fromEntries(selected.map((key) => [key, record[key]])), source: filename, correction });
  }
  for (const dataset of datasets) for (const key of selected) {
    if (typeof dataset[key] !== 'string' || !dataset[key].trim()) throw new Error(`Dataset ${dataset.id} needs authored ${key}`);
  }
  if (new Set(datasets.map((d) => d.id)).size !== datasets.length) throw new Error('Duplicate dataset ID');
  const categories = reader.constant(CATEGORIES, 'DATASET_CATEGORIES');
  if (!Array.isArray(categories) || categories.some((c) => typeof c !== 'string') || new Set(categories).size !== categories.length) throw new Error('Invalid dataset categories');
  for (const dataset of datasets) if (!categories.includes(dataset.category)) throw new Error(`Unknown category: ${dataset.category}`);
  const contracts = reader.file(CONTRACTS).statements.filter((s) =>
    (ts.isInterfaceDeclaration(s) || ts.isTypeAliasDeclaration(s)) && s.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword));
  const printer = ts.createPrinter({ removeComments: true, newLine: ts.NewLineKind.LineFeed });
  const declarations = contracts.map((s) => ({ name: s.name.text, declaration: printer.printNode(ts.EmitHint.Unspecified, s, reader.file(CONTRACTS)) }));
  const view = reader.file('src/appRouter.ts').statements.find((s) => ts.isTypeAliasDeclaration(s) && s.name.text === 'AppView');
  if (!view || !ts.isUnionTypeNode(view.type) || view.type.types.some((t) => !ts.isLiteralTypeNode(t) || !ts.isStringLiteral(t.literal))) throw new Error('AppView must be a union of string literals');
  const views = view.type.types.map((t) => t.literal.text);
  const tabs = reader.constant('src/explorer/explorerTabs.ts', 'EXPLORER_TABS');
  if (!Array.isArray(tabs) || tabs.some((t) => !Array.isArray(t) || t.length !== 2 || t.some((v) => typeof v !== 'string')) || new Set(tabs.map((t) => t[0])).size !== tabs.length) throw new Error('Invalid explorer tabs');
  return { datasets, categories, contracts: declarations, views, tabs };
}

// Accepts `const f = (x) => cond ? { ...x, expressionUnit: value } : x` (either
// branch order): the record passes through with at most its unit replaced.
function isUnitOnlyRelabel(source, name) {
  const init = variables(source).get(name);
  if (!init || !ts.isArrowFunction(init) || init.parameters.length !== 1 || !ts.isIdentifier(init.parameters[0].name)) return false;
  const param = init.parameters[0].name.text;
  const body = unwrap(init.body);
  if (!ts.isConditionalExpression(body)) return false;
  const passes = (node) => ts.isIdentifier(unwrap(node)) && unwrap(node).text === param;
  const relabels = (node) => {
    const object = unwrap(node);
    if (!ts.isObjectLiteralExpression(object) || object.properties.length !== 2) return false;
    const [spread, unit] = object.properties;
    return ts.isSpreadAssignment(spread) && passes(spread.expression)
      && ts.isPropertyAssignment(unit) && propertyName(unit.name) === 'expressionUnit';
  };
  return (passes(body.whenFalse) && relabels(body.whenTrue)) || (passes(body.whenTrue) && relabels(body.whenFalse));
}

function applyReviewedMetadata(reader, filename, records) {
  const source = reader.file(filename);
  const fn = source.statements.find((s) => ts.isFunctionDeclaration(s) && s.name?.text === 'reviewedStudyMetadata');
  const fail = () => { throw new Error(`Unsupported reviewed metadata adapter in ${filename}; extend static extraction`); };
  if (!fn?.body || fn.parameters.length !== 1 || !ts.isIdentifier(fn.parameters[0].name) || fn.body.statements.length !== 2) fail();
  const name = fn.parameters[0].name.text;
  const [guard, result] = fn.body.statements;
  if (!ts.isIfStatement(guard) || guard.elseStatement || !ts.isBinaryExpression(guard.expression) || guard.expression.operatorToken.kind !== ts.SyntaxKind.ExclamationEqualsEqualsToken || guard.expression.left.getText(source) !== `${name}.id` || !ts.isStringLiteral(guard.expression.right) || !ts.isReturnStatement(guard.thenStatement) || guard.thenStatement.expression?.getText(source) !== name || !ts.isReturnStatement(result) || !result.expression || !ts.isObjectLiteralExpression(result.expression)) fail();
  const [spread, ...fields] = result.expression.properties;
  if (!spread || !ts.isSpreadAssignment(spread) || spread.expression.getText(source) !== name || fields.some((p) => !ts.isPropertyAssignment(p))) fail();
  const overrides = Object.fromEntries(fields.map((p) => [propertyName(p.name), reader.value(filename, p.initializer)]));
  return records.map((record) => record.id === guard.expression.right.text ? { ...record, ...overrides } : record);
}

