// Extract new texts & update translations.
'use strict';


const SourceKeys      = require('./source_keys');
const TranslationKeys = require('./translation_keys');
const AppError        = require('./app_error');

const { getPluralKeys }  = require('./plurals');


// null, or plural with all forms null
function isUntranslated(value) {
  if (value === null) return true;
  return value?.constructor === Object && Object.values(value).every(v => v === null);
}

// keysByFile: { fileName: [ key, ... ] }
function formatKeysReport(title, keysByFile) {
  let msg = `${title}\n\n`;

  Object.entries(keysByFile).forEach(([ file, keys ]) => {
    msg += `  ${file}\n`;
    msg += keys.map(k => `    ${k}\n`).join('');
  });

  return msg;
}


module.exports.subparserInfo = {
  command:  'extract',
  options:  {
    description:  'Scan sources and update translations with missed keys'
  }
};


module.exports.subparserArgsList = [
  {
    args:     [ '-s' ],
    options: {
      dest:     'sources',
      help:     'source file(s) path (glob patterns allowed)',
      type:     'str',
      action:   'append',
      metavar:  '<path>',
      required: true
    }
  },
  {
    args:     [ '-t' ],
    options: {
      dest:     'translations',
      help:     'translation file(s) path (glob patterns allowed)',
      action:   'append',
      metavar:  '<path>',
      required: true
    }
  },
  {
    args:     [ '-c' ],
    options: {
      dest:         'check_only',
      help:         "check only, don't update translations",
      action:       'store_true',
      default: false
    }
  },
  {
    args:     [ '--orphaned-fail' ],
    options: {
      dest:         'orphaned_fail',
      help:         'stop with error on orphaner phrases',
      action:       'store_true',
      default: false
    }
  },
  {
    args:     [ '--remove-orphaned' ],
    options: {
      dest:     'remove_orphaned',
      help:     'remove orphaned phrases: "untranslated" (default) only those without translation, ' +
                '"all" every orphaned phrase',
      nargs:    '?',
      const:    'untranslated',
      choices:  [ 'untranslated', 'all' ],
      metavar:  '<mode>'
    }
  },
  {
    args:     [ '--dump-sourceref' ],
    options: {
      dest:         'dump_sourceref',
      help:         'dump the location of the extracted message keys to the given file',
      metavar:  '<filename>'
    }
  }
];


module.exports.execute = function (args) {
  /* eslint no-console: off */
  let sourceKeys = new SourceKeys();
  let translationKeys = new TranslationKeys();

  sourceKeys.loadFiles(args.sources);

  if (!sourceKeys.filesCount) {
    throw new AppError ('Failed to find any source file');
  }

  if (!sourceKeys.keys.length) {
    console.log('No phrases to translate');
    return;
  }

  translationKeys.loadFiles(args.translations);

  // We should have locales to fill with keys. Those may be missed only
  // when no files found at all (file without locale will fail to load).
  if (!translationKeys.filesCount) {
    throw new AppError (`
Failed to find any translation file. Create empty templates with locale names
to start. Example:

File "en-EN.yml", content - "en-GB: ~"
`);
  }

  //
  // Check orphaned phrases
  //
  let orphaned = {};
  let removed = {};

  // Copy, because phrases may be removed while iterating
  translationKeys.phrases.slice().forEach(p => {
    if (sourceKeys.uniques.hasOwnProperty(p.key)) return;

    let remove = args.remove_orphaned === 'all' ||
      (args.remove_orphaned === 'untranslated' && isUntranslated(p.value));

    if (remove) translationKeys.removePhraseObj(p.locale, p.key);

    let report = remove ? removed : orphaned;
    if (!report[p.fileName]) report[p.fileName] = [];

    report[p.fileName].push(p.key);
  });

  if (Object.keys(orphaned).length) {
    let msg_orphaned = formatKeysReport('Your translations have orphaned phrases:', orphaned);

    if (args.orphaned_fail) throw new AppError(msg_orphaned);
    else console.log(msg_orphaned);
  }

  //
  // fill missed phrases
  //
  Object.entries(translationKeys.localeDefaultFile).forEach(([ locale, fileName ]) => {
    Object.entries(sourceKeys.uniques).forEach(([ keyName, keyObj ]) => {
      let phraseObj = translationKeys.getPhraseObj(locale, keyName);

      if (!phraseObj) {
        // Not exists -> add new one
        translationKeys.addPhrase({
          locale,
          key: keyName,
          value: !keyObj.plural ? null : Object.fromEntries(getPluralKeys(locale).map(k => [ k, null ])),
          fileName
        });
      } else if (!(phraseObj.value?.constructor === Object) !== !keyObj.plural) {
        // Translation already exists -> check type (singular/plural)
        // and throw on mismatch
        throw new AppError(`
"${keyName}" - mixed singular/plural in source and translation

${keyObj.fileName}
${phraseObj.fileName}
`);
      }
    });
  });

  translationKeys.saveFiles();

  if (Object.keys(removed).length) {
    console.log(formatKeysReport('Removed orphaned phrases:', removed));
  }

  if (args.dump_sourceref) {
    sourceKeys.dumpSourceRef(args.dump_sourceref);
  }
};
