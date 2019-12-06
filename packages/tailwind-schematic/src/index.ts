import { ProjectDefinition } from '@angular-devkit/core/src/workspace';
import { chain, Rule, SchematicContext, Tree } from '@angular-devkit/schematics';
import { NodePackageInstallTask } from '@angular-devkit/schematics/tasks';
import {
  getLatestNodeVersion,
  getWorkspace,
  mergePackageJson,
  NodeDependencyType,
  NodePackage,
  parseJsonAtPath,
  PkgJson,
} from '@schuchard/schematic-utils';
import { concat, Observable, of } from 'rxjs';
import { concatMap, map } from 'rxjs/operators';
import { mergeWith, isArray } from 'lodash';
import { JsonObject, normalize } from '@angular-devkit/core';

const enum Names {
  WebpackConfig = 'webpack-config.js',
}

interface SchematicOptions {
  project: string;
  webpackConfigPath: string;
  projectRoot: string;
  projectSourceRoot: string;
  inlineStyles: boolean;
}

export function tailwindSchematic(_options: SchematicOptions): Rule {
  return async (tree: Tree, _context: SchematicContext) => {
    await determineProject(tree, _options);

    return chain([updateDependencies(), updateAngularJson(_options)]);
  };
}

async function determineProject(
  tree: Tree,
  _options: SchematicOptions
): Promise<{ project: ProjectDefinition }> {
  const workspace = await getWorkspace(tree);

  const projectName: string = _options.project || (workspace.extensions.defaultProject as string);
  const project = workspace.projects.get(projectName);

  if (project === undefined) {
    throw new Error('No project found in workspace');
  }

  // update with project metadata
  _options.project = projectName;
  _options.projectRoot = project.root;
  _options.projectSourceRoot = project.sourceRoot || '';

  return { project };
}

function updateDependencies(): Rule {
  return (tree: Tree, context: SchematicContext): Observable<Tree> => {
    context.logger.debug('Updating dependencies...');
    context.addTask(new NodePackageInstallTask());

    const addDependencies = of('tailwindcss').pipe(
      concatMap((packageName: string) => getLatestNodeVersion(packageName)),
      map((packageFromRegistry: NodePackage) => {
        const { name, version } = packageFromRegistry;
        context.logger.debug(`Adding ${name}:${version} to ${NodeDependencyType.Dev}`);

        tree.overwrite(
          PkgJson.Path,
          JSON.stringify(
            mergePackageJson(tree, { [NodeDependencyType.Default]: { [name]: version } }),
            null,
            2
          )
        );
        return tree;
      })
    );

    const addDevDependencies = of(
      '@angular-builders/custom-webpack',
      '@fullhuman/postcss-purgecss'
    ).pipe(
      concatMap((packageName: string) => getLatestNodeVersion(packageName)),
      map((packageFromRegistry: NodePackage) => {
        const { name, version } = packageFromRegistry;
        context.logger.debug(`Adding ${name}:${version} to ${NodeDependencyType.Dev}`);

        tree.overwrite(
          PkgJson.Path,
          JSON.stringify(
            mergePackageJson(tree, { [NodeDependencyType.Dev]: { [name]: version } }),
            null,
            2
          )
        );
        return tree;
      })
    );

    return concat(addDependencies, addDevDependencies);
  };
}

function updateAngularJson(_options: SchematicOptions): Rule {
  return (tree: Tree, _context: SchematicContext) => {
    console.log('here');

    const aj = parseJsonAtPath(tree, './angular.json') as any;
    const { project, projectRoot } = _options;
    const stylesheetPath = normalize(`${projectRoot}/src/tailwind.scss`);

    const updates = {
      projects: {
        [project]: {
          architect: {
            build: {
              builder: '@angular-builders/custom-webpack:browser',
              options: {
                customWebpackConfig: {
                  path: Names.WebpackConfig,
                },
                styles: [stylesheetPath],
              },
            },
            serve: {
              builder: '@angular-builders/custom-webpack:dev-server',
              options: {
                customWebpackConfig: {
                  path: Names.WebpackConfig,
                },
              },
            },
          },
        },
      },
    };

    tree.overwrite(
      './angular.json',
      JSON.stringify(mergeWith(aj, updates, mergeCustomizer), null, 2)
    );
    return tree;
  };
}

function mergeCustomizer(objValue: JsonObject, srcValue: JsonObject) {
  if (isArray(objValue)) {
    return objValue.concat(srcValue);
  }
}
