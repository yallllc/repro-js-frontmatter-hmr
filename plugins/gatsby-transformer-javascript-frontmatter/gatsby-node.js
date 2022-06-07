const _ = require(`lodash`);
const babylon = require(`@babel/parser`);
const traverse = require(`@babel/traverse`).default;

const frontmatterToken = `frontmatter`;

const fileExtsToProcess = [`js`, `jsx`, `ts`, `tsx`];

function unstable_shouldOnCreateNode({ node }) {
  // This only processes JavaScript and TypeScript files.
  return fileExtsToProcess.includes(node.extension);
}

async function onCreateNode({
  node,
  actions,
  loadNodeContent,
  createContentDigest,
}) {
  if (!unstable_shouldOnCreateNode({ node })) {
    return;
  }

  const { createNode, createParentChildLink } = actions;

  const code = await loadNodeContent(node);
  const options = {
    sourceType: `module`,
    allowImportExportEverywhere: true,
    plugins: [
      `jsx`,
      `doExpressions`,
      `objectRestSpread`,
      [
        `decorators`,
        {
          decoratorsBeforeExport: true,
        },
      ],
      `classProperties`,
      `exportExtensions`,
      `asyncGenerators`,
      `functionBind`,
      `functionSent`,
      `dynamicImport`,
      _.includes([`ts`, `tsx`], node.extension) ? `typescript` : `flow`,
    ],
  };

  let frontmatter;
  let error;
  try {
    const ast = babylon.parse(code, options);

    const parseData = function parseData(node) {
      let value;

      if (node.type === `TemplateLiteral`) {
        // Experimental basic support for template literals:
        // Extract and join any text content; ignore interpolations
        value = node.quasis.map((quasi) => quasi.value.cooked).join(``);
      } else if (node.type === `ObjectExpression`) {
        value = {};
        node.properties.forEach((elem) => {
          value[elem.key.name] = parseData(elem.value);
        });
      } else if (node.type === `ArrayExpression`) {
        value = node.elements.map((elem) => parseData(elem));
      } else {
        value = node.value;
      }

      return value;
    };

    const getFrontmatterDeclarator = (declarations) =>
      _.find(declarations, (d) => d.id.name === frontmatterToken);

    const assignFields = (properties) => {
      properties.forEach(
        (node) => (frontmatter[node.key.name] = parseData(node.value))
      );
    };

    frontmatter = {};
    error = false;
    traverse(ast, {
      // Support plain top-level `const frontmatter`, since export breaks fast refresh
      VariableDeclaration: function VariableDeclaration(astPath) {
        if (astPath.parent.type === `Program` && astPath.node.declarations) {
          const declarator = getFrontmatterDeclarator(
            astPath.node.declarations
          );

          if (declarator && declarator.init) {
            assignFields(declarator.init.properties);
          }
        }
      },
      // Support class component `this.frontmatter`, e.g. in constructor
      AssignmentExpression: function AssignmentExpression(astPath) {
        if (
          astPath.node.left.type === `MemberExpression` &&
          astPath.node.left.property.name === frontmatterToken
        ) {
          assignFields(astPath.node.right.properties);
        }
      },
      // Support `export const frontmatter`, which breaks fast refresh
      ExportNamedDeclaration: function ExportNamedDeclaration(astPath) {
        const { declaration } = astPath.node;
        if (declaration && declaration.type === `VariableDeclaration`) {
          const dataVariableDeclarator = getFrontmatterDeclarator(
            declaration.declarations
          );

          if (dataVariableDeclarator && dataVariableDeclarator.init) {
            assignFields(dataVariableDeclarator.init.properties);
          }
        }
      },
    });
  } catch (e) {
    // stick the error on the query so the user can
    // react to an error as they see fit
    error = {
      err: true,
      code: e.code,
      message: e.message,
      stack: e.stack,
    };
  } finally {
    // only create node if frontmatter is not empty
    if (!_.isEmpty(frontmatter)) {
      const contentDigest = createContentDigest(node);
      const nodeData = {
        id: `${node.id} >>> JavascriptFrontmatter`,
        children: [],
        parent: node.id,
        node: { ...node },
        internal: {
          contentDigest,
          type: `JavascriptFrontmatter`,
        },
        frontmatter: {
          ...frontmatter,
          error: error,
        },
      };

      if (node.internal.type === `File`) {
        nodeData.fileAbsolutePath = node.absolutePath;
      }

      createNode(nodeData);
      createParentChildLink({ parent: node, child: nodeData });
    }
  }
}

exports.unstable_shouldOnCreateNode = unstable_shouldOnCreateNode;
exports.onCreateNode = onCreateNode;
