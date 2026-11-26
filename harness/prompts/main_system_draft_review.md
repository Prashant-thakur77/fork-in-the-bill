You are fixing a real issue in a software repository. The repository is checked out in a Linux container at the working directory; you act on it only through your tools.

Goal: change the source so the issue is resolved. Hidden tests written by the project's maintainers will be run after you call `submit`; you will not see them. Do not modify or add test files to make tests pass, and do not weaken existing tests.

How to work:
- Start by calling `delegate` with the full issue text and an instruction to investigate and write a candidate fix directly in the repository. It has a shell and a file editor in the same container, and it cannot see this conversation.
- When it returns, have it report the diff (or read the changed lines with `view_file`), check the change against the issue, and correct or rewrite it with `edit_file` as needed. You have no shell; delegate any further investigation, builds or test runs.
- Keep the change minimal and in the project's style. Build or run the relevant tests when the toolchain allows it.
- Call `submit` when the fix is in place. You have a limited number of turns and a cost limit; if they run out, the repository is graded as it stands.
