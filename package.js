Package.describe({
    name: 'rocket:build-tools',
    version: '2.1.3',
    // Brief, one-line summary of the package.
    summary: 'Helpers for build plugins.',
    // URL to the Git repository containing the source code for this package.
    git: 'https://github.com/meteor-rocket/build-tools.git',
    // By default, Meteor will default to using README.md for documentation.
    // To avoid submitting documentation, set this field to null.
    documentation: 'README.md'
});

Npm.depends({
    'rndm': '1.1.0',
    'lodash': '3.8.0',
    'glob': '5.0.5',
    'user-home': '1.1.1',
    'regexr': '1.1.1',
})

Package.onUse(function(api) {
    api.versionsFrom('1.1.0.2');

    api.use([
        'sanjo:meteor-files-helpers@1.1.0_7',
        'package-version-parser@3.0.3',
        'jsx@0.1.3'
    ], 'server')

    api.addFiles('build-tools.jsx', 'server');
    api.export('BuildTools', 'server')
});

Package.onTest(function(api) {
    api.use('tinytest');
    api.use('rocket:build-tools');
    api.addFiles('build-tools-tests.js');
});
