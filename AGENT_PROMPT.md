# AI Agent Prompt: Submitting the `js-krauset` Benchmark

## Your Role and Goal

You are an expert software engineer. Your task is to submit the newly created `js-krauset` benchmark to the official `js-framework-benchmark` repository. You must follow the contribution guidelines meticulously to ensure the pull request is accepted.

## Context

- **Target Repository:** [krausest/js-framework-benchmark](https://github.com/krausest/js-framework-benchmark)
- **Benchmark Implementation:** A new benchmark named `js-krauset` has been created. It is an implementation of the benchmark's "keyed" mode application.
- **Technology Stack:** The `js-krauset` implementation uses **React** for rendering and a custom state management library called **@storable/core**.
- **Source Code:** The complete, production-ready source code for the `js-krauset` benchmark is located in the `packages/js-krauset` directory of the current project. **You do not need to write any code; your task is to integrate and submit this existing package.**

## Step-by-Step Instructions

### Step 1: Set Up the Benchmark Environment

1.  Clone the official `js-framework-benchmark` repository into a new, separate directory.
    ```bash
    git clone https://github.com/krausest/js-framework-benchmark.git
    cd js-framework-benchmark
    ```
2.  Install the root-level dependencies. It is critical to use `npm ci` as recommended by the project's documentation.
    ```bash
    npm ci
    ```
3.  Install the local server dependencies.
    ```bash
    npm run install-local
    ```

### Step 2: Integrate the `js-krauset` Package

1.  Copy the entire `packages/js-krauset` directory from your current project into the `frameworks/keyed/` directory of the `js-framework-benchmark` repository you just cloned.
    ```bash
    # Example command (adjust paths as necessary):
    # cp -r /path/to/your/project/packages/js-krauset /path/to/js-framework-benchmark/frameworks/keyed/
    ```
2.  The copied directory (`js-framework-benchmark/frameworks/keyed/js-krauset`) contains everything needed: a `package.json` with dependencies, a pre-configured Vite build, and the application source code.

### Step 3: Verify the Implementation

This is the most critical phase. You must ensure the benchmark runs correctly within the official environment before submitting.

1.  Start the benchmark's web server from the root of the `js-framework-benchmark` directory. Keep this server running in a dedicated terminal.
    ```bash
    npm start
    ```
2.  In a new terminal, run the automated benchmark specifically for the `js-krauset` implementation. This command will install its dependencies and run all performance tests.
    ```bash
    npm run bench -- --framework keyed/js-krauset
    ```
3.  Observe the output carefully. The benchmark should complete without any errors. If it fails, troubleshoot the integration steps. Do not proceed until the benchmark runs successfully.
4.  After the benchmark completes, run the official validation script. This checks for common issues like incorrect keyed/non-keyed classification and build problems.
    ```bash
    npm run rebuild-ci keyed/js-krauset
    ```
5.  This command must also complete successfully without printing any large `ERROR` messages.

### Step 4: Submit the Pull Request

1.  Create a new branch for your submission.
    ```bash
    git checkout -b feat/add-js-krauset-benchmark
    ```
2.  Add the new `js-krauset` directory to Git.
    ```bash
    git add frameworks/keyed/js-krauset
    ```
3.  Commit the changes with a descriptive message.
    ```bash
    git commit -m "feat: Add keyed js-krauset (React + storable) benchmark"
    ```
4.  Push the branch to your fork of the repository.
    ```bash
    git push -u origin feat/add-js-krauset-benchmark
    ```
5.  Create a pull request against the `master` branch of the `krausest/js-framework-benchmark` repository.
    - **Title:** `feat: Add keyed js-krauset (React + storable) benchmark`
    - **Body:** Briefly describe the submission. Mention that it uses React and the `@storable/core` state management library.

## Important Constraints

-   **DO NOT** commit any generated files, such as `webdriver-ts-results/`, `table.html`, or any `results.json` files. The repository maintainer will generate these.
-   **DO NOT** modify any files outside of the `frameworks/keyed/js-krauset` directory.
-   The source code in `packages/js-krauset` is complete and verified. You should not need to modify its contents. Your primary task is integration and verification.
