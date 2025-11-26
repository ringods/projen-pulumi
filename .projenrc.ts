import { cdk, javascript } from 'projen';
import { ReleaseTrigger } from 'projen/lib/release';

const project = new cdk.JsiiProject({
  author: 'Ringo De Smet',
  authorAddress: 'ringo@de-smet.name',
  defaultReleaseBranch: 'main',
  jsiiVersion: '~5.9.0',
  name: '@ringods/projen-pulumi',
  packageManager: javascript.NodePackageManager.NPM,
  projenrcTs: true,
  repositoryUrl: 'https://github.com/ringo/projen-pulumi.git',
  gitignore: ['.idea/'],
  deps: ['projen'], /* Runtime dependencies of this module. */
  devDeps: ['projen', 'ts-node'], /* Build dependencies for this module. */
  peerDeps: ['projen'], /* Peer dependencies of this module. */
  releaseTrigger: ReleaseTrigger.manual(),
});

// @ts-ignore
project.github.actions.set('actions/checkout', 'actions/checkout@v6');

project.synth();