#!/usr/bin/env node

const stdin = process.openStdin();
const { stdout } = process;
const yargs = require("yargs/yargs");
const { hideBin } = require("yargs/helpers");
const chalk = require("chalk");
const { exec } = require("child_process");

const info = chalk.green("i");
const warning = chalk.yellow("WARNING:");

const main = async ({
  production,
  tagPrefix,
  environment,
  noticeFolderChanges,
}) => {
  const env = environment || (production ? "PROD" : "dev");
  console.log(info, "Deploying to " + env);
  if (!isDefaultYes(await askQuestion(`Is this ok? [Y/n]`))) {
    console.log(info, "Aborted.");
    process.exit(1);
  }

  const gitOutput = await runShellCommand("git status");

  const mBranch = /On branch (.*)/.exec(gitOutput),
    //mPushed = /Your branch is up to date with 'origin\//.exec(gitOutput),
    mNoChanges = /nothing to commit, working tree clean/.exec(gitOutput);
  console.log(info, "On git branch:", mBranch[1]);
  if (!mNoChanges) {
    console.log(warning, "There are uncommited changes");
    console.log(info, "Aborted.");
    process.exit(1);
  }

  const today = new Date(),
    day = ("0" + today.getDate()).slice(-2),
    month = ("0" + (today.getMonth() + 1)).slice(-2),
    hour = today.getHours(),
    minute = today.getMinutes(),
    tagNamePrefix = `${tagPrefix ? tagPrefix + "-" : ""}${env}`,
    shouldTagName = `${tagNamePrefix}-${day}-${month}-${today.getFullYear()}-${hour}-${minute}`;

  await runShellCommand("git tag " + shouldTagName);

  const gitTagOutput = await runShellCommand(
      'git log --tags --simplify-by-decoration --pretty="format: %d" -1'
    ),
    mTag = new RegExp("\\(HEAD -> [^,]+, .*?tag: " + shouldTagName).exec(
      gitTagOutput
    );
  if (!mTag) {
    throw "Git tag is missing, should have been " + shouldTagName;
  } else {
    console.log(info, "Git tag:", shouldTagName);
  }

  // check for noticeFolder changes
  const gitLastTags = (
    await runShellCommand(
      "git for-each-ref --sort=creatordate --format '%(refname)' refs/tags"
    )
  )
    .split("\n")
    .filter((tag) => new RegExp(tagNamePrefix).test(tag))
    .reverse();
  if (gitLastTags[1]) {
    for (const folder of noticeFolderChanges) {
      const gitChanged = await runShellCommand(
        `git diff ${gitLastTags[0]} ${gitLastTags[1]} --stat -- ${folder}`
      );

      if (gitChanged) {
        console.log(info, `Changes in ${folder} since last release:\n`);
        console.log(gitChanged);
        console.log(warning, "ATTENTION", `${folder} changed`);
        console.log(warning, "Please take the required actions!");

        if (isDefaultNo(await askQuestion(`Continue? [y/N]`))) {
          console.log(info, "Aborted.");
          process.exit(1);
        }
      }
    }
  } else {
    console.log(warning, "ATTENTION", "No previous tags found!.");
    console.log(warning, "This could mean, that initial setup is required.");
    console.log(warning, "Please take the required actions!");
    if (isDefaultNo(await askQuestion(`Continue? [y/N]`))) {
      console.log(info, "Aborted.");
      process.exit(1);
    }
  }
  console.log(info, "Ready for deploy.");
  process.exit(0);
};

const argv = yargs(hideBin(process.argv))
  .command("$0", "", (yargs) => yargs.usage("$0"))
  .option("production", {
    type: "boolean",
    description: "Deploy into an production environment.",
  })
  .option("environment", {
    type: "string",
    description:
      'Environment name. Defaults to "PROD" for production and "dev" otherwise.',
  })
  .option("tagPrefix", {
    type: "string",
    description: "Specify a prefix for the git-tag.",
  })
  .option("noticeFolderChanges", {
    type: "array",
    description:
      "Specify one or multiple folders in which changes should be explicitly stated to the user.",
  })

  .help()
  .alias("help", "h").argv;

const {
  _: [region = "eu-central-1", lambdaName],
  production,
  environment,
  tagPrefix,
  noticeFolderChanges,
} = argv;

main({
  region,
  lambdaName,
  production,
  environment,
  tagPrefix,
  noticeFolderChanges: noticeFolderChanges || [],
})
  .then(() => {
    console.log(info, "Done.");
    process.exit(0);
  })
  .catch((e) => {
    console.log(chalk.red("ERROR:"), e);
    process.exit(1);
  });

function isDefaultYes(answer) {
  return answer === "y" || answer === "Y" || answer === "";
}

function isDefaultNo(answer) {
  return answer !== "y" && answer !== "Y";
}

async function askQuestion(question, PAD_TO_COLLUM = 0) {
  stdout.write(" ".repeat(PAD_TO_COLLUM) + chalk.yellow("? ") + question + " ");

  const input = await getUserInput();

  return input;
}

async function getUserInput() {
  return new Promise((res) => {
    stdin.addListener("data", (d) => {
      res(d.toString().trim());
    });
  });
}

async function runShellCommand(command) {
  return new Promise((res, rej) => {
    exec(
      command,
      { env: { ...process.env, LC_ALL: "en_US.UTF-8" } },
      (error, stdout) => {
        if (error !== null) {
          rej(error);
        } else {
          res(stdout);
        }
      }
    );
  });
}
