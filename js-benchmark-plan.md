# Plan for a Local Framework Benchmark Comparison

This is a simplified guide for creating a local benchmark for your framework and comparing its performance against `react-zustand`. This plan is for personal use and omits steps related to submitting your framework to the official repository.

## 1. Project Setup

First, you'll need to get the main benchmark project set up on your machine.

- **Prerequisites:** Ensure you have `node.js` installed (v20.9.0 or higher is recommended).
- **Clone the repository:**
  ```bash
  git clone https://github.com/krausest/js-framework-benchmark.git
  ```
- **Install dependencies:**
  ```bash
  cd js-framework-benchmark
  npm ci
  npm run install-local
  ```

## 2. Implement Your Framework

Next, you'll create the benchmark application using your framework. For this guide, we'll assume you are creating a "keyed" implementation.

- **Create the Directory:** Make a new folder for your project inside the `frameworks` directory.
  ```bash
  mkdir frameworks/keyed/my-framework
  ```
- **Create `package.json`:** Inside `frameworks/keyed/my-framework`, create a `package.json` file.
  - It must have a `build-prod` script that compiles your application into a distributable format (e.g., a single JS bundle).
  - List all your dependencies with **fixed versions** (e.g., `"1.2.3"`, not `"^1.2.3"`).
- **Create `index.html`:** Create an `index.html` file in your framework's directory.
  - This file must replicate the HTML structure from the `vanillajs` example (`frameworks/keyed/vanillajs/index.html`). Pay close attention to the button `id`s and the table's class names, as the benchmark runner depends on them.
  - You must link to the global stylesheet: `<link href="/css/currentStyle.css" rel="stylesheet" />`.
- **Write the Application Logic:**
  - Build your application to handle all the required operations triggered by the buttons:
    - Create 1,000 / 10,000 rows
    - Append 1,000 rows
    - Update every 10th row
    - Clear all rows
    - Swap two rows
    - Select a row (by clicking on it)
    - Remove a row (by clicking its delete icon)

## 3. Run the Comparison Benchmark

Once your implementation is ready and works correctly when tested manually, you can run the automated benchmark.

- **Start the Web Server:** In a terminal, from the root `js-framework-benchmark` directory, run:

  ```bash
  npm start
  ```

  Keep this server running in the background.

- **Run the Benchmarks:** In a new terminal, run the benchmark command, specifying both your framework and `react-zustand`.

  ```bash
  # Note: react-zustand is in the 'keyed' directory.
  # Replace 'my-framework' with your directory's name.
  npm run bench -- --framework keyed/my-framework keyed/react-zustand
  ```

  This will take a few minutes as it runs through all the tests for both frameworks.

- **Generate the Results Table:** After the benchmark finishes, generate the comparison table.

  ```bash
  npm run results
  ```

- **View the Results:** With the `npm start` server still running, you can view the results in your browser by navigating to:
  [http://localhost:8080/webdriver-ts-results/table.html](http://localhost:8080/webdriver-ts-results/table.html)

You will see a table comparing the performance metrics of your framework directly against `react-zustand`.
