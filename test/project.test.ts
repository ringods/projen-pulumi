import { Testing } from 'projen/lib/testing';
import { PulumiProject } from '../src';

test('snapshot', () => {
  const project = new PulumiProject({
    name: 'test',
    runtime: 'python',
  });
  const snapshot = Testing.synth(project);
  expect(snapshot).toMatchSnapshot();
});