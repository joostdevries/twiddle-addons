/* global require, module */
var EmberApp = require('ember-cli/lib/broccoli/ember-app');
var mergeTrees = require('ember-cli/lib/broccoli/merge-trees');
var Funnel = require('broccoli-funnel');
var concat = require('broccoli-concat');
var writeFile = require('broccoli-file-creator');
var path = require('path');
var assetRev = require('broccoli-asset-rev');
var stew = require('broccoli-stew');
var DEBUG = false;

EmberApp.env = function() { return 'development'; }

function StubApp(options) {
  return Reflect.construct(EmberApp, [options], StubApp);
}
Reflect.setPrototypeOf(StubApp.prototype, EmberApp.prototype);
Reflect.setPrototypeOf(StubApp, EmberApp);

// We don't want any of the default legacy files. But we *do* still
// want to let addons stick their own imports into the
// legacyFilesToAppend list.
StubApp.prototype.populateLegacyFiles = function() {};

var importedJsFiles = [];
var importedCssFiles = [];

var filesToExclude = [
  'loader.js',
  'legacy-shims.js',
  'app-shims.js',
  'deprecations.js',
  'jquery.js'
];

// Files included via app.import need to end up in addon.js
StubApp.prototype.import = function(assetPath, options) {
  options = options || {};

  if (typeof assetPath === 'object') {
    assetPath = assetPath[this.env];
  }

  if (filesToExclude.filter(file => assetPath.indexOf(file) !== -1).length === 0) {

    if (DEBUG) {
      console.log(assetPath);
    }

    var ext = path.extname(assetPath);
    var isCss = ext === '.css';
    var isJs = ext === '.js';
    if (isCss) {
      if (options.prepend) {
        importedCssFiles.unshift(assetPath);
      } else {
        importedCssFiles.push(assetPath);
      }
    } else if (isJs) {
      if (options.prepend) {
        importedJsFiles.unshift(assetPath);
      } else {
        importedJsFiles.push(assetPath);
      }
    }
  }

  EmberApp.prototype.import.call(this, assetPath, options);
};

var quickTemp = require('quick-temp');
var fs = require('fs');

function EmptyTree(names) {
  this.names = names || [];
}

EmptyTree.prototype.read = function() {
  var dir = quickTemp.makeOrReuse(this, 'emptyTree');
  this.names.forEach(function(name) {
    fs.writeFileSync(path.join(dir, name), '');
  });
  return dir;
};

EmptyTree.prototype.cleanup = function() {
  if (!DEBUG) {
    quickTemp.remove(this, 'tmpCacheDir');
  }
};


module.exports = function() {
  var app = new StubApp({
    name: 'twiddle',
    sourcemaps: {
      enabled: false
    },
    minifyCSS: {
      enabled: false,
    },
    minifyJS: {
      enabled: false
    },
    trees: {
      app: new EmptyTree(),
      styles: new EmptyTree(['app.css', 'app.scss']),
      templates: new EmptyTree(),
      public: new EmptyTree()
    }
  });

  var origAddonTree = new Funnel(app.addonTree(), {
    exclude: ['*/ember-load-initializers/**/*.js', '*/ember-resolver/**/*.js']
  });

  if (DEBUG) {
    origAddonTree = stew.debug(origAddonTree, { name: 'origAddonTree' });
  }

  var addonTree = concat(mergeTrees([origAddonTree, app.addonSrcTree()]), {
    inputFiles: '**/*.js',
    outputFile: 'vendor/addons.js'
  });

  var addonTestSupportTree = concat(app.addonTestSupportTree(), {
    inputFiles: '**/*.js',
    outputFile: 'vendor/addon-test-support.js',
    allowNone: true
  });

  var fullTree = mergeTrees([
    app.getAddonTemplates(),
    app.getStyles(),
    app.getTests(),
    app.getExternalTree(),
    app.getSrc(),
    app.getAppJavascript(false),
    addonTree,
    addonTestSupportTree
  ].filter(Boolean), { overwrite: true });

  fullTree = new Funnel(fullTree, {
    exclude: ['*/ember-load-initializers/**/*.js', '*/ember-resolver/**/*.js']
  });

  var templates = writeFile('twiddle/templates/.gitkeep', '');
  fullTree = mergeTrees([fullTree, templates]);

  if (DEBUG) {
    fullTree = stew.debug(fullTree, { name: 'fullTree' });
  }

  var processedTree = mergeTrees([
    app._defaultPackager.processAppAndDependencies(fullTree),
    app._defaultPackager.packageStyles(fullTree)
  ]);

  if (DEBUG) {
    processedTree = stew.debug(processedTree, { name: 'processedTree' });
  }

  var headerFiles = importedJsFiles
    .concat(app.legacyFilesToAppend || [])
    .concat(['vendor/addons.js', 'vendor/addon-test-support.js']);

  var cssTree = concat(processedTree, {
    headerFiles: importedCssFiles,
    inputFiles: ['**/*.css'],
    outputFile: '/addon.css',
    allowNone: false,
    sourceMapConfig: { enabled: false },
    annotation: 'Concat: Addon CSS'
  });

  var publicTree = new Funnel(app.getPublic(), {
    srcDir:'assets',
    destDir:'.',
    allowEmpty:true
  });

  var jsTree = concat(processedTree, {
    headerFiles: headerFiles,
    inputFiles: ['twiddle/**/*.js'],
    outputFile: '/addon.js',
    allowNone: true,
    sourceMapConfig: { enabled: false },
    annotation: 'Concat: Addon JS'
  });

  var mergedTree = mergeTrees([cssTree, publicTree, jsTree]);

  var fingerprintedTree = new assetRev(mergedTree, {
    generateAssetMap: true
  });

  return fingerprintedTree;
};
