import { Project, ProjectOptions, github } from 'projen';
import { ProjenrcTsOptions, ProjenrcTs } from 'projen/lib/typescript';

export interface PulumiProjectOptions extends ProjectOptions {
  readonly projenrc?: ProjenrcTsOptions;
  /**
   * Name of the Pulumi stack to use as the test stack. This stack is deployed first.
   * @default "dev"
   */
  readonly testStack?: string;
  /**
   * Working directory for Pulumi commands (relative to repo root).
   * @default "."
   */
  readonly workDir?: string;
  /**
   * Pulumi program runtime. Determines how dependencies are installed in CI workflows.
   * Accepts Pulumi supported runtimes: "python", "java", "go", "yaml", "nodejs", "dotnet".
   * @default "nodejs"
   */
  readonly runtime: 'python' | 'java' | 'go' | 'yaml' | 'nodejs' | 'dotnet';
}

export class PulumiProject extends Project {
  constructor(options: PulumiProjectOptions) {
    super(options);

    const projenrc = options.projenrc ?? {};
    if (!this.parent && projenrc) {
      new ProjenrcTs(this, projenrc);
    }

    const gh = new github.GitHub(this, {
      pullRequestLint: false,
    });
    const mainWorkflow = gh.addWorkflow('main');
    mainWorkflow.on({
      push: {
        branches: ['main'],
      },
    });

    const testStack = options.testStack ?? 'dev';
    const workDir = options.workDir ?? '.';
    const runtime = options.runtime ?? 'nodejs';

    // Determine dependency installation command based on runtime
    const installDepsCommand = (() => {
      switch (runtime) {
        case 'python':
          return 'uv sync';
        case 'go':
          return 'go mod download';
        case 'dotnet':
          return 'dotnet restore';
        case 'java':
          // Using Maven as a generic Java dependency resolver; adjust in consumer if needed
          return 'mvn -B -DskipTests dependency:resolve';
        case 'yaml':
          return "echo 'No dependencies to install for Pulumi YAML'";
        case 'nodejs':
        default:
          return 'npm ci';
      }
    })();

    // Choose correct runtime setup action per selected Pulumi runtime
    const runtimeSetupStep: github.workflows.JobStep | undefined = (() => {
      switch (runtime) {
        case 'python':
          return { uses: 'actions/setup-python@v5', with: { 'python-version': '3.x' } };
        case 'go':
          return { uses: 'actions/setup-go@v5', with: { 'go-version': 'stable' } };
        case 'dotnet':
          return { uses: 'actions/setup-dotnet@v4', with: { 'dotnet-version': '8.x' } };
        case 'java':
          return { uses: 'actions/setup-java@v4', with: { 'distribution': 'temurin', 'java-version': '17' } };
        case 'yaml':
          return undefined; // no language runtime to setup
        case 'nodejs':
        default:
          return { uses: 'actions/setup-node@v6', with: { 'node-version': 'lts/*' } };
      }
    })();

    // Common steps prior to Pulumi commands
    const commonSetupSteps: github.workflows.JobStep[] = [
      { uses: 'actions/checkout@v6' },
      ...(runtimeSetupStep ? [runtimeSetupStep] : []),
      { name: 'Install dependencies', run: installDepsCommand },
    ];

    // Job: Discover stacks dynamically using `pulumi stack ls --json`
    mainWorkflow.addJobs({
      discover: {
        runsOn: ['ubuntu-latest'],
        permissions: { contents: github.workflows.JobPermission.READ },
        steps: [
          ...commonSetupSteps,
          {
            id: 'discover',
            name: 'Discover stacks',
            shell: 'bash',
            workingDirectory: workDir,
            run: [
              'set -euo pipefail',
              'echo "Listing stacks..."',
              // Get the JSON list of stacks, map to names, filter out the test stack
              `ALL=$(pulumi stack ls --json | node -e "const fs=require('fs');const data=JSON.parse(fs.readFileSync(0,'utf8'));const names=data.map(s=>s.name);const filtered=names.filter(n=>n!=='${testStack}');process.stdout.write(JSON.stringify(filtered));")`,
              'echo "stacks=$ALL" >> $GITHUB_OUTPUT',
            ].join('\n'),
          },
        ],
        outputs: {
          stacks: { stepId: 'discover', outputName: 'stacks' },
        },
      },
    });

    // Job: Deploy test stack first
    mainWorkflow.addJobs({
      test: {
        needs: ['discover'],
        runsOn: ['ubuntu-latest'],
        permissions: { contents: github.workflows.JobPermission.READ },
        steps: [
          ...commonSetupSteps,
          {
            name: `Pulumi up (test stack: ${testStack})`,
            uses: 'pulumi/actions@v6',
            with: {
              'command': 'up',
              'stack-name': testStack,
              'work-dir': workDir,
              'github-token': '${{ secrets.GITHUB_TOKEN }}',
              'comment-on-pr': 'false',
              'yes': 'true',
            },
            env: {
              // Ensure access to Pulumi backend if the repo sets this secret
              PULUMI_ACCESS_TOKEN: '${{ secrets.PULUMI_ACCESS_TOKEN }}',
            },
          },
        ],
      },
    });

    // Job: Deploy remaining stacks in parallel (if any)
    mainWorkflow.addJobs({
      deploy: {
        needs: ['discover', 'test'],
        runsOn: ['ubuntu-latest'],
        permissions: { contents: github.workflows.JobPermission.READ },
        // Only run if there are stacks other than the test stack
        if: `${'${{'} needs.discover.outputs.stacks != '[]' ${'}}'}`,
        strategy: {
          matrix: {
            domain: {
              // Dynamically provide stacks discovered at runtime
              stack: `${'${{'} fromJSON(needs.discover.outputs.stacks) ${'}}'}` as unknown as string[],
            },
          },
        },
        steps: [
          ...commonSetupSteps,
          {
            name: 'Pulumi up (matrix stack)',
            uses: 'pulumi/actions@v6',
            with: {
              'command': 'up',
              'stack-name': '${{ matrix.stack }}',
              'work-dir': workDir,
              'github-token': '${{ secrets.GITHUB_TOKEN }}',
              'comment-on-pr': 'false',
              'yes': 'true',
            },
            env: {
              PULUMI_ACCESS_TOKEN: '${{ secrets.PULUMI_ACCESS_TOKEN }}',
            },
          },
        ],
      },
    });
  }

}