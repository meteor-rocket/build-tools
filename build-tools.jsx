// npm builtin modules
var path               = Npm.require('path')
var fs                 = Npm.require('fs')
var os                 = Npm.require('os')

// npm modules
var rndm               = Npm.require('rndm')
var _                  = Npm.require('lodash')
var glob               = Npm.require('glob')
var userHome           = Npm.require('user-home')
var regexr             = Npm.require('regexr')

// meteor package imports
var MeteorFilesHelpers = Package['sanjo:meteor-files-helpers'].MeteorFilesHelpers
var PackageVersion     = Package['package-version-parser'].PackageVersion

const PACKAGE_DIRS     = _.get(process, 'env.PACKAGE_DIRS')
const USER_HOME        = userHome
const PLATFORM_NAMES   = [
    'os',
    'web.browser',
    'web.cordova'
]

// A regex for finding the names of files inside the built files of isopacks.
var FILENAME_REGEX        = regexr`/\/+\n\/\/ +\/\/\n\/\/ (packages\/(?:\S+:)?\S+\/\S+).+((?:\n\/\/ (?:\S+).+)*)\n\/\/ +\/\/\n\/+\n +\/\//g`
                                                       // └───────────────────────────┘  └─────────────────────┘
                                                       //              ▴                            ▴
                                                       //              |                            └── File info, if any. capture group #2
                                                       //              └── File name. capture group #1

/**
 * Get the current app's path.
 * See: https://github.com/Sanjo/meteor-meteor-files-helpers/blob/71bbf71c1cae57657d79df4ac6c73defcdfe51d0/src/meteor_files_helpers.js#L11
 *
 * @return {string|null} The full path to the application we are in, or null if
 * we're not in an application.
 */
function getAppPath() {
    return MeteorFilesHelpers.getAppPath()
}

/**
 * Get the current app's packages path, even if it doesn't actually exist.
 *
 * @return {string|null} Return the path as a string, or null if we're not in an app.
 */
function getAppPackagesPath() {
    var app = getAppPath()
    if (app) return path.resolve(app, 'packages')
    return null
}

/**
 * Returns the path of the package in the given CompileStep.
 *
 * Use this with the deprecated Package.registerSourceHandler API.
 *
 * @param {CompileStep} compileStep The given CompileStep.
 * @return {string} The path to the package.
 */
function packageDirFromCompileStep(compileStep) {
    return path.resolve(compileStep.fullInputPath.replace(compileStep.inputPath, ''))
}

/**
 * Get a list of installed packages in the current application. If
 * explicitlyInstalled is truthy, then only explicitly installed package names
 * are returned.
 *
 * TODO: Return package constraint strings when explicitlyInstalled is true.
 *
 * @param {boolean} [explicitlyInstalled] If true, get only explicitly installed packages.
 * @return {Array.string} An array of package names.
 */
function getInstalledPackages(explicitlyInstalled) {
    var fileName = explicitlyInstalled ? 'packages' : 'versions'
    var app = getAppPath()
    if (!app) throw new Error('getInstalledPackages is meant to be used while the directory that `meteor` is currently running in is a Meteor application.')
        // TODO: ^ Make a single function for this check, put it in build-tools
    var packagesFile = path.resolve(app, '.meteor', fileName)
    var lines = getLines(packagesFile)
    var packages = []
    packages = _.reduce(lines, function(result, line) {
        if (!line.match(/^#/) && line.length !== 0) result.push(line.split('@')[0])
        return result
    }, packages)
    return packages
}

/**
 * @returns {boolean} Returns true if we're not running `meteor test-packages`
 * or `meteor publish` which means this file is being executed during an app's
 * build, not a package's build.
 */
function isAppBuild() {
  var unAcceptableCommands = {'test-packages': 1, 'publish': 1};
  if(process.argv.length > 2) {
    var command = process.argv[2];
    if(unAcceptableCommands[command]) {
      return false;
    }
  }

  return true;
}

/**
 * @typedef PackageInfo
 *
 * An object containing info about a package installed in the current
 * application. Besides the below described properties you'll also find the
 * properties that `Package.describe` accepts in it's first argument when the
 * package is found locally. Packages in ~/.meteor/packages don't have info
 * obtainable from a package.js file.  See
 * http://docs.meteor.com/#/full/packagedescription
 *
 * @type {Object}
 * @property {string} name The name of the package.
 * @property {string} isopackPath The full path of the package's isopack.
 * @property {Array.string} dependencies An array of package names that are the
 * dependencies of this package, each name appended with @<version> if a
 * version is found. The array is empty if there are no dependencies.
 * @property {Array.string} files An array of files that are added to the
 * package (the files of a package that are specified with api.addFiles)
 */

/**
 * Get a list of the packages depending on the named package in the current
 * application.
 *
 * @param {string} packageName The name of the package to check dependents for.
 * @return {Array.PackageInfo|null} An array of objects, each object containing
 * info on a dependent of the specified package. The array is empty if no
 * dependents are found.
 *
 * TODO: The result of this should instead be in the `dependents` key of the
 * result of `getPackageInfo()`. This means we'll have to take out the logic
 * for finding a package's dependencies out of the `getPackageInfo` function
 * into it's own `getPackageDependencies` function. We can then *not* use
 * `getPackageInfo` inside of this `getDependentsOf` function so that we can
 * use getDependentsOf inside of getPackageInfo and include that info in the
 * result.
 */
function getDependentsOf(packageName) {
    var app = getAppPath()
    if (!app) throw new Error('getDependentsOf is meant to be used while the directory that `meteor` is currently running in is a Meteor application.')
    var packages = getInstalledPackages()
    return _.reduce(packages, function(result, package) {
        package = getPackageInfo(package)
        if (package && _.find(package.dependencies, function(dep) { return dep.match(packageName) }))
            result.push(package)
        return result
    }, [])
}

/**
 * @param {string} packageName The name of a package.
 * @return {string|null} Returns the local path of a package, null if not found.
 */
function getLocalPackagePath(packageName) {
    var localPath = path.resolve(getAppPath(), 'packages', toLocalPackageName(packageName))
    if (fs.existsSync(localPath)) return localPath
    else if (PACKAGE_DIRS) {
        localPath = path.resolve(PACKAGE_DIRS, toLocalPackageName(packageName))
        if (fs.existsSync(localPath)) return localPath
    }
    return null
}

/**
 * @param {string} packageName The name of a package.
 * @return {boolean} Returns true if the package is local to the app, false otherwise.
 */
function isLocalPackage(packageName) {
    return getLocalPackagePath(packageName) ? true : false
}

/**
 * Get the path to the isopack of a package. This is the path to the isopack
 * that is used in the current app.
 *
 * @param {string} packageName The name of the package.
 * @return {string} The path to the isopack.
 *
 * TODO: consider PACKAGE_DIRS env variable.
 */
function getIsopackPath(packageName) {
    var app = getAppPath()
    if (!app) throw new Error('getIsopackPath is meant to be used while the directory that `meteor` is currently running in is a Meteor application.')
    var isopackPath
    if (isLocalPackage(packageName)) {
        isopackPath = path.resolve(
            app, '.meteor', 'local', 'isopacks', toIsopackName(packageName))
    }
    else {
        isopackPath = path.resolve(
            USER_HOME, '.meteor', 'packages', toIsopackName(packageName),
            getInstalledVersion(packageName))
    }
    return isopackPath
}

/**
 * Get info about a package given it's package.js source.
 *
 * @param {string} packageDotJsSource The source code of a given package.js file.
 * @param {string} packagePath The path to a package.
 * @return {Object} A subset of the PackageInfo type that includes the `path` and
 * `dependencies` keys.
 *
 * TODO: Don't set localPath here, add it externally with _.assign.
 * TODO: Don't set isopackPath here, add it externally with _.assign.
 *
 * TODO: List the "meteor" dependency? It is listed in the isopack, so gotta
 * find out why (maybe because api.versionsFrom is used? Or maybe just all
 * packages always depend on "meteor"?).
 */
function getInfoFromPackageDotJs(packageDotJsSource, packagePath) {
    function apiDot(name, ...signature) {
        var r = regexr
        signature = _.reduce(signature, (result, signaturePiece, index) => {
            return r`${result}${
                index !== 0 ? r`\s*,\s*` : r``
            }(${signaturePiece})`
        }, '')
        return r`/(api\s*\.\s*${name}\s*\(\s*(${signature})\s*\)\s*;*)/g`
    }

    let r = regexr
    let stringRegex             = r`/['"][^'"]*['"]/g`
    let stringArrayRegex        = r`/\[(\s*(${stringRegex}\s*,?)\s*)*\]/g`
    let stringOrStringArrayRgx  = r`/${stringRegex}|${stringArrayRegex}/g`
    let singleLevelObjectRegex  = r`{[^{}]*}` // can be improved, but works for this purpose

    let apiDotVersionsFromRegex = apiDot('versionsFrom', stringOrStringArrayRgx)
    let apiDotUseRegex          = r`(${apiDot('use', stringOrStringArrayRgx)}|${apiDot('use', stringOrStringArrayRgx, stringOrStringArrayRgx)}|${apiDot('use', stringOrStringArrayRgx, singleLevelObjectRegex)}|${apiDot('use', stringOrStringArrayRgx, stringOrStringArrayRgx, singleLevelObjectRegex)})`
    let apiDotImplyRegex        = r`(${apiDot('imply', stringOrStringArrayRgx)}|${apiDot('imply', stringOrStringArrayRgx, stringOrStringArrayRgx)})`
    let apiDotExportRegex       = r`(${apiDot('export', stringOrStringArrayRgx)}|${apiDot('export', stringOrStringArrayRgx, stringOrStringArrayRgx)}|${apiDot('export', stringOrStringArrayRgx, singleLevelObjectRegex)}|${apiDot('use', stringOrStringArrayRgx, stringOrStringArrayRgx, singleLevelObjectRegex)})`
    let apiDotAddFilesRegex     = r`(${apiDot(r`(addFiles|add_files)`, stringOrStringArrayRgx)}|${apiDot(r`(addFiles|add_files)`, stringOrStringArrayRgx, stringOrStringArrayRgx)}|${apiDot(r`(addFiles|add_files)`, stringOrStringArrayRgx, singleLevelObjectRegex)}|${apiDot(r`(addFiles|add_files)`, stringOrStringArrayRgx, stringOrStringArrayRgx, singleLevelObjectRegex)})`
                                                           // ^ also add_files for COMPAT WITH 0.8.x

    let apiCallsRegex = r`(${apiDotVersionsFromRegex}|${apiDotUseRegex}|${apiDotImplyRegex}|${apiDotExportRegex}|${apiDotAddFilesRegex})`

    let npmDotDependsRegex = r`/Npm\s*\.\s*depends\s*\(\s*${singleLevelObjectRegex}\s*\)/g`

    let packageDotDescribeRegex = r`/Package\s*\.\s*describe\s*\(\s*${singleLevelObjectRegex}\s*\)/g`
    let packageDotOnTestRegex   = r`/Package\s*\.\s*onTest\s*\(\s*function\s*\(\s*${r.identifier}\s*\)\s*{\s*(${apiCallsRegex})+\s*}\s*\)/g`

    // Remove Package.onTest calls, for now.
    // TODO TODO v1.0.0: We can't write recursive regexes in JavaScript, so
    // parse char by char instead of with regexes for package.* calls. Or just
    // look for info only in isopacks to avoid this altogether?
    packageDotJsSource = packageDotJsSource.replace(packageDotOnTestRegex, '')

    // Get the package description from the Package.describe call.
    let packageDescription = packageDotDescribeRegex.exec(packageDotJsSource)
    packageDescription = new RegExp(singleLevelObjectRegex).exec(packageDescription[0])
    if (packageDescription) {
        // We have to eval the object literal string. We can't use
        // JSON.parse because it's not valid JSON.
        eval("packageDescription = "+packageDescription[0])
    }

    // Get npm dependencies from the Npm.depends call if any.
    let npmDependencies = npmDotDependsRegex.exec(packageDotJsSource)
    if (npmDependencies) {
        npmDependencies = new RegExp(singleLevelObjectRegex).exec(npmDependencies[0])
        if (npmDependencies) {
            // We have to eval the object literal string. We can't use
            // JSON.parse because it's not valid JSON.
            eval("npmDependencies = "+npmDependencies[0])
        }
    }

    // Get the dependencies based on api.use calls.
    // TODO: Also include in the result which architecture each dependency is for.
    let dependencies = []
    // TODO: Extend RegExp in regexr and add a .flags() method for easily changing the flags.
    let apiDotUseCalls = packageDotJsSource.match(r`/${apiDotUseRegex}/g`)
    if (apiDotUseCalls) {
        dependencies = _.reduce(apiDotUseCalls, function(result, apiDotUseCall) {
            let packageStrings = apiDotUseCall
                .match(r`/${stringOrStringArrayRgx}/g`)[0].match(r`/${stringRegex}/g`)
            if (packageStrings) {
                packageStrings = _.map(packageStrings, function(packageString) {
                    return packageString.replace(/['"]/g, '')
                })
                result = result.concat(packageStrings)
            }
            return result
        }, dependencies)
    }

    // get the added files based on api.addFiles calls.
    let apiDotAddFilesCalls = packageDotJsSource.match(r`/${apiDotAddFilesRegex}/g`)
    let addedFiles = []
    if (apiDotAddFilesCalls) {
        addedFiles = _.reduce(apiDotAddFilesCalls, function(result, apiDotAddFilesCall) {
            let fileNameStrings = apiDotAddFilesCall
                .match(r`/${stringOrStringArrayRgx}/g`)[0].match(r`/${stringRegex}/g`)
            if (fileNameStrings) {
                fileNameStrings = _.map(fileNameStrings, function(fileNameString) {
                    return fileNameString.replace(/['"]/g, '')
                })
                result = result.concat(fileNameStrings)
            }
            return result
        }, addedFiles)
    }

    let isopackPath = getIsopackPath(packageDescription.name)

    return _.assign(packageDescription, {
        localPath: packagePath,
        isopackPath: isopackPath,
        dependencies: dependencies, // empty array if no dependencies are found
        npmDependencies: npmDependencies,
        files: addedFiles // empty array if no files are added
    })
}

/**
 * Given an isopack, get the JSON result from isopack.json if it exists, then
 * unipackage.json if it exists, otherwise null if neither exist.
 *
 * NOTE: This is for isopack-1 isopacks.
 *
 * @param {string} isopackPath The full path to an isopack.
 * @return {Object|null} The JSON.parsed result, or null if the files are not
 * found.
 */
function isoOrUni(isopackPath) {
    var isoUniPath = path.join(isopackPath, 'isopack.json')
    var result

    // if the isopack.json path doesn't exist
    if (!fs.existsSync(isoUniPath))
        isoUniPath = path.join(isopackPath, 'unipackage.json')

    // if the unipackage.json path doesn't exist
    if (!fs.existsSync(isoUniPath))
        isoUniPath = null


    // if one of the two files was found, return the parsed JSON result, otherwise null.
    if (isoUniPath) {
        result = JSON.parse(fs.readFileSync(isoUniPath).toString())

        // If we're using isopack.json, get the isopack-1 object.
        // XXX: Is the top-most key in isopack.json always "isopack-1"? If
        // not, handle the possiblity of a different key name.
        if (isoUniPath.match(/isopack\.json/)) {
            if (typeof result['isopack-1'] !== 'undefined')
                result = result['isopack-1']
            else
                // XXX: If it happens, let's catch it. Someone will complain and we'll fix it. x)
                throw new Error('isopack-1 is undefined. Please report this issue. Thanks!')
        }

        return result
    }
    return null
}

/**
 * Get the dependencies from an isopack's os.json, web.browser.json,
 * and web.cordova.json files.
 *
 * NOTE: This is for isopack-1 isopacks.
 *
 * @param {string} isopackPath The full path to an isopack.
 * @return {Array.string} An array of package constraint strings being the
 * dependencies of the given isopack.
 *
 * XXX: Make this less naive? The result doesn't show which deps are for which
 * architectures, and assumes the versions are the same across
 * architectures.
 *
 * XXX: Do we have to handle specific architectures like "os.linux"?
 */
function getDependenciesFromIsopack(isopackPath) {
    // get the `uses` array of each platform file and merge them together uniquely.
    var dependencies = _.reduce(PLATFORM_NAMES, function(dependencies, name) {
        var pathToFile = path.resolve(isopackPath, name+'.json')
        if (fs.existsSync(pathToFile)) {
            var info = JSON.parse(fs.readFileSync(pathToFile).toString())
            dependencies = _.unique(_.union(dependencies, info.uses), 'package')
        }
        return dependencies
    }, [])

    // convert each use into a package constraint string.
    dependencies = _.map(dependencies, function(use) {
        return use.package + (typeof use.constraint !== 'undefined' ? '@'+use.constraint : '')
    })

    return dependencies
}

/**
 * Get the a list of files that were added to a package (using api.addFiles)
 * from its isopack.
 *
 * NOTE: This is for isopack-1 isopacks.
 *
 * @param {string} isopackPath The full path to an isopack.
 * @return {Array.string} An array containing the full names of added files.
 * Empty if there are none.
 *
 * TODO: Include which arches each file is added for.
 */
function getAddedFilesFromIsopack(isopackPath) {
    var isoUniResult = isoOrUni(isopackPath)
    if (!isoUniResult) throw new Error('isopack.json or unipackage.json not found!? Please report this at github.com/trusktr/rocket-module/issues')

    var packageName = isoUniResult.name
    var isopackName = toIsopackName(packageName)

    var files = _.reduce(PLATFORM_NAMES, function(files, platformName) {
        var compiledFilePath = path.resolve(
            isopackPath, platformName, 'packages', isopackName+'.js')

        if (fs.existsSync(compiledFilePath)) {
            var filenameSections = fs.readFileSync(compiledFilePath).toString().match(FILENAME_REGEX)

            _.each(filenameSections, function(filenameSection) {
                var fileName = filenameSection.match(
                    new RegExp(FILENAME_REGEX.source))[1] // capture #1 (without the g flag)

                // TODO: Does this work in Windows? I'm assuming the fileName
                // values here use unix forward slashes no matter what arch.
                files.push(fileName.replace('packages/'+packageName+'/', ''))
            })
        }

        return files
    }, [])

    return _.unique(files)
}

/**
 * Get a list of npm packages that the isopack depends on.
 *
 * NOTE: This is for isopack-1 isopacks.
 *
 * @param {string} isopackPath The full path to an isopack.
 * @return {Object} An object listing npm dependencies, just like what you'd
 * pass into Npm.depends.
 */
function getNpmDependenciesFromIsopack(isopackPath) {
    let npmPath = path.resolve(isopackPath, 'npm', 'node_modules')
    let packages

    let npmDependencies = null

    if (fs.existsSync(npmPath)) {
        packages = fs.readdirSync(npmPath)

        // remove hidden folders
        packages = _.filter(packages, function(package) {
            return !package.match(/^\./)
        })
    }

    if (packages && packages.length) {
        npmDependencies = {}

        _.each(packages, function(package) {
            let packageDotJson = path.resolve(npmPath, package, 'package.json')
            packageDotJson = JSON.parse(fs.readFileSync(packageDotJson).toString())

            npmDependencies[package] = packageDotJson.version
        })
    }

    return npmDependencies
}

/**
 * Get PackageInfo from an isopack (usually a package in the global
 * ~/.meteor/packages directory or application's .meteor/local/isopacks
 * directory).
 *
 * NOTE: This is for isopack-1 isopacks.
 *
 * @param {string} isopackPath The full path to an isopack.
 * @return {Object} A subset of the PackageInfo type that includes the `path` and
 * `dependencies` keys.
 *
 * TODO: Don't add isopackPath here, add it externally with _.assign.
 */
function getInfoFromIsopack(isopackPath) {
    var isoUniResult = isoOrUni(isopackPath)
    if (!isoUniResult) throw new Error('isopack.json or unipackage.json not found!? Please report this at github.com/trusktr/rocket-module/issues')
    var result = {}
    var dependencies = []

    if (isoUniResult) {
        result = _.assign(result, _.pick(isoUniResult, 'name', 'summary', 'version'))
    }

    dependencies = getDependenciesFromIsopack(isopackPath)
    npmDependencies = getNpmDependenciesFromIsopack(isopackPath)
    addedFiles = getAddedFilesFromIsopack(isopackPath)

    result = _.assign(result, {
        isopackPath: isopackPath,
        dependencies: dependencies,
        npmDependencies: npmDependencies,
        files: addedFiles
    })

    return result
}

/**
 * Get the version of an installed package.
 *
 * @param {string} packageName The name of the package.
 * @return {string|null} The version of the package or null if the package
 * isn't installed.
 *
 * XXX: Handle wrapper numbers? f.e. 0.2.3_3 with the underscore
 */
function getInstalledVersion(packageName) {
    var app = getAppPath()
    if (!app) throw new Error('getInstalledVersion is meant to be used while the directory that `meteor` is currently running in is a Meteor application.')
    var packagesFile = path.resolve(app, '.meteor', 'versions')
    var lines = getLines(packagesFile)
    var line = _.find(lines, function(line) {
        return line.match(new RegExp(packageName))
    })
    if (line) return line.split('@')[1]
    return null
}

/**
 * Get info about a package if it exists in the local application or in
 * ~/.meteor/packages. Unless specified, info will be for the currently
 * installed version of the package that is found in the current application
 * falling back to the latest version found in ~/.meteor/packages. If a version
 * is specified but doesn't exist, or if no version is specified and no version
 * exists at all, null is returned.
 *
 * @param {string} packageName The name of a package, including the username:
 * prefix if not an MDG package.
 * @param {string} [packageVersion] The version of the package to get info for.
 * Defaults to (in the following order) the version installed in the
 * application, or the latest version found if not installed in the
 * application.
 * @return {PackageInfo|null} An object containing details about the specified
 * package, or null if the package is not found.
 *
 * TODO: Handle isopack-2 isopacks.
 *
 * TODO: Account for PACKAGE_DIRS environment variable. This function assumes
 * that local packages are in the default location in the `packages` folder of
 * the application, but this might not be the case if a different path is
 * specified with the PACKAGE_DIRS environment variable.
 *
 * TODO: If no local packages, local isopacks, or global isopacks are found,
 * get info from online but if no internet connection, return null.
 *
 * TODO: Also include files added in Package.onTest in the `files` property of
 * the returned PackageInfo.
 */
function getPackageInfo(packageName, packageVersion) {

    var packageDotJsPath, packageInfo

    var packageFound = false

    // If the package is made by MDG, it has no username or organization prefix (vendor name).
    var packageLocalName = toLocalPackageName(packageName)

    // First check the app's local packages directory. If the package
    // exists locally and either the user didn't specify a version or the user
    // specified a version that happens to be the version of the local package
    //
    // TODO?: Handle packages that have the same package name but with the same
    // vendor name since the folder names would be the same.
    //
    // TODO: For local packages, look in `.meteor/isopacks`/ instead of in
    // `packages/`. The logic will then be the same as in `else` block of this
    // conditional. This also eliminates the previous "TODO?". Perhaps keep
    // this first logic for the `packages/` directory, then first look in the
    // local `.meteor/local/isopacks/` before finally looking in
    // `~/.meteor/packages/`.
    var app = getAppPath()
    if (app) packageDotJsPath = path.resolve(app, 'packages', packageLocalName, 'package.js')
    if (
        app && (fs.existsSync(packageDotJsPath) && !packageVersion) ||
        app && (fs.existsSync(packageDotJsPath) && packageVersion &&
                    PackageVersion.compare(getInstalledVersion(packageName), packageVersion) === 0)
    ) {
        let packageDotJsSource = fs.readFileSync(packageDotJsPath).toString()
        packageInfo = getInfoFromPackageDotJs(packageDotJsSource, getPath(packageDotJsPath))
    }

    // Otherwise check ~/.meteor/packages, and either find the package with the
    // version specified, or the max version of the specified package if no
    // version was specified.
    else {
        let packageIsopackName = toIsopackName(packageName)

        // If the package exists in ~/.meteor/packages
        let packagePath = path.join(USER_HOME, '.meteor/packages', packageIsopackName)
        if (fs.existsSync(packagePath)) {

            // Get the valid versions.
            let versions = path.join(USER_HOME, '.meteor/packages', packageIsopackName, '*')
            versions = glob.sync(versions)
            versions = _.reduce(versions, function(result, versionPath) {
                var version = getFileName(versionPath)
                var isValidVersion
                try { isValidVersion = PackageVersion.getValidServerVersion(version) } catch (e) {}
                if (isValidVersion) result.push(version)
                return result
            }, [])

            // If any versions exist, find the specified version, or find the
            // maximum version if a specific version wasn't specified. No
            // version is found if a version is specified but doesn't exist.
            if (versions.length > 0) {
                let foundVersion
                if (packageVersion && _.contains(versions, packageVersion))
                    foundVersion = packageVersion
                else if (!packageVersion)
                    foundVersion = _.max(versions, function(version) {
                        return PackageVersion.versionMagnitude(version)
                    })

                if (foundVersion) {
                    packageInfo = getInfoFromIsopack(path.join(USER_HOME, '.meteor/packages', packageIsopackName, foundVersion))
                }
            }
        }
    }

    // If a package was found, get the package info, otherwise return null.
    if (packageInfo) return packageInfo
    return null
}

/**
 * Gets the id of the current application.
 *
 * @return {string} The id.
 */
function getAppId() {
    var app = getAppPath()
    if (!app) throw new Error('getAppId is meant to be used while the directory that `meteor` is currently running in is a Meteor application.')
    return fs.readFileSync(
        path.resolve(app, '.meteor', '.id')
    ).toString().trim().split('\n').slice(-1)[0] // the last line of the file.
}

/**
 * Convert a package name to an isopack name.
 *
 * @param {string} packageName The name to convert.
 * @return {string} The isopack name.
 */
function toIsopackName(packageName) {
    return packageName.split(':').join('_')
}

/**
 * Convert an isopack name to a package name.
 *
 * @param {string} isopackName The name to convert.
 * @return {string} The isopack name.
 */
function toPackageName(isopackName) {
    return isopackName.split('_').join(':')
}

/**
 * Get the local name of a package. This is the packageName in
 * userName:packageName, which is what Meteor also names the folder of a local
 * package.
 *
 * @param {string} packageName The full name of a package.
 * @return {string} The local name of the package.
 */
function toLocalPackageName(packageName) {
    var nameParts = packageName.split(':')
    return nameParts[nameParts.length - 1]
}

/**
 * Get the path to the meteor executable that we're running in.
 *
 * @return {string} The path to the executable.
 */
function getMeteorPath() {
    return MeteorFilesHelpers.getMeteorToolPath()
}

/**
 * Get the directory from which paths passed to Npm.reqire are
 * rooted (determined internally by Meteor and out of our control).
 * For example, if Npm.require is rooted to `/path/to/foo`, then
 * `Npm.require('../some/thing')` will actually do
 * `require('/path/to/foo/../some/thing')` internally. This
 * function will return `/path/to/foo` in this case.
 *
 * @return {string} The path that Npm.require is rooted to.
 */
function getMeteorNpmRequireRoot() {
    let randomString = rndm(24)
    try {
        // "./" is needed in order to trigger an error about a
        // package not existing, otherwise Npm.require mysteriously
        // returns undefined if the package doesn't exist. For example:
        //
        // Npm.require('asdflkjahsdf') // no error, returns undefined.
        // Npm.require('./asdflkjahsdf') // error
        Npm.require('.'+path.sep+randomString) // require a package not likely to exist.
        return getMeteorNpmRequireRoot() // in the highly unlikely event the random package exists. Get a littery ticket if this happens.
    }
    catch (error) {
        // error.toString() currently looks like this:
        // Error: Cannot find module '/path/to/node_modules/packageName'
        // The root is '/path/to/node_modules'.
        let attemptedPackagePath = error.toString().split("'")[1] // /path/to/node_modules/packageName
        let rootPath = getPath(attemptedPackagePath) // /path/to/node_modules
        return rootPath
    }
}

/**
 * Require files from the directory where the Meteor executable is located.
 *
 * @param {string} moduleName The path to a file where Meteor is located.
 * @return {Object} The module.exports of the file.
 *
 * TODO: Test this while not using Meteor from a git checkout.
 */
function requireFromMeteor(moduleName) {
    let meteorPath = getMeteorPath()
    let rootNpmPath = getMeteorNpmRequireRoot()
    let commonPath = getCommonAncestorPath(meteorPath, rootNpmPath)

    return Npm.require(
        ''+
        path.relative(rootNpmPath, commonPath) +
        path.sep +
        path.relative(commonPath, meteorPath) +
        path.sep +
        moduleName
    )
}

BuildTools = {
    PLATFORM_NAMES,
    PACKAGE_DIRS,
    USER_HOME,
    FILENAME_REGEX,
    getAppPath,
    getAppPackagesPath,
    packageDirFromCompileStep,
    getInstalledPackages,
    getLines,
    isAppBuild,
    getDependentsOf,
    getLocalPackagePath,
    isLocalPackage,
    getIsopackPath,
    getInfoFromPackageDotJs,
    isoOrUni,
    getDependenciesFromIsopack,
    getAddedFilesFromIsopack,
    getNpmDependenciesFromIsopack,
    getInfoFromIsopack,
    getInstalledVersion,
    getPackageInfo,
    getAppId,
    toIsopackName,
    toPackageName,
    toLocalPackageName,
    getFileName,
    getPath,
    getMeteorPath,
    indexOfObjectWithKeyValue,
    getMeteorNpmRequireRoot,
    getCommonAncestorPath,
    requireFromMeteor
}

// TODO: move everything below this to army-knife on npm.

/**
 * Get the lines of a file as an array.
 *
 * @param {string} file A file to read.
 * @return {Array.string} An array of the lines in the file.
 */
function getLines(file) {
    return fs.readFileSync(file).toString().split('\n')
}

/**
 * Get the last part of a path (the file name).
 *
 * @param {string} filePath A path to a file.
 * @return {string} The file name.
 */
function getFileName(filePath) {
    var parts = filePath.split(path.sep)
    return parts[parts.length-1]
}

/**
 * Get all but the last part of a full path.
 *
 * @param {string} filePath A path to a file.
 * @return {string} The path.
 */
function getPath(filePath) {
    let result = filePath.replace(getFileName(filePath), '')
    return result.replace(/\/$/, '') // remove trailing slash if any.
}

/**
 * Get the index of the object in an array that has the specified key value pair.
 *
 * @param {Array.Object} array An array containing Objects.
 * @param {string} key The key to check in each Object.
 * @param {?} value The value to check the key for (absolute equality).
 * @return {number} The integer index of the first Object found that has the key value pair.
 *
 * TODO: Is there already something like this in lodash or underscore? If not, move to army-knife.
 */
function indexOfObjectWithKeyValue(array, key, value) {
    var index = -1
    for (var i=0; i<array.length; i+=1) {
        if (array[i][key] && array[i][key] === value) {
            index = i
            break
        }
    }
    return index
}

/**
 * Get the common ancestor path of a set of paths.
 *
 * @param {Array.string} ...inputPaths The paths from which to find the ancestor path.
 * @return {string|null} The ancestor path, null if one doesn't exist.
 */
function getCommonAncestorPath(...inputPaths) {
    let commonPath = null

    // for each inputPath, get an array of the path parts split by
    // the platform separator (f.e. '/path/to/foo' becomes ['',
    // 'path', 'to', 'foo']
    let ancestorArrays = _.map(inputPaths, (inputPath) => {
        return inputPath.split(path.sep)
    })

    // check that directory names match, starting at the root of each path.
    let index = 0
    while (true) {
        let currentDirectory = ancestorArrays[0][index]

        // check if we've reached the end of at least one path, in which case there's no common ancestor so break the loop.
        let indexOutOfBounds = !_.every(ancestorArrays, (ancestorArray) => {
            return typeof ancestorArray[index] !== 'undefined'
        })

        if (indexOutOfBounds) break

        let directoryNameSet = _.map(ancestorArrays, (ancestorArray) => {
            return ancestorArray[index]
        })

        let allNamesMatchAtCurrentLevel = _.every(directoryNameSet, (directoryName) => {
            return directoryName === currentDirectory
        })

        // as soon as we find a level where the directory names diverge.
        if (!allNamesMatchAtCurrentLevel) {
            commonPath = ancestorArrays[0].slice(0, index).join(path.sep)
            break
        }

        index += 1
    }

    return commonPath
}
