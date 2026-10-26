#!/usr/bin/python3 -I
"""Root-owned forced-command gateway; there is no generic remote shell."""

import os
import re
import sys

COMMAND = re.compile(r"(receive|publish|validate) ([0-9a-f]{40})\Z")
PUBLISHER = "/usr/local/libexec/publish-mysql-compare"


def parse_command(command):
    match = COMMAND.fullmatch(command)
    if not match:
        raise ValueError("Only a fixed MySQL Compare receive/publish/validate command is allowed.")
    return match.groups()


def main():
    try:
        command, revision = parse_command(os.environ.get("SSH_ORIGINAL_COMMAND", ""))
    except ValueError as error:
        print(str(error), file=sys.stderr)
        return 2
    os.execv(PUBLISHER, [PUBLISHER, command, revision])
    return 0


if __name__ == "__main__":
    sys.exit(main())
