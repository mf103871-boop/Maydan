"""Execute the actual Foundation-only URL policy without importing the ads SDK."""
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[2]


def method(source, name):
    start = source.index('    static func ' + name + '(')
    opening = source.index('{', start)
    depth = 1
    cursor = opening + 1
    while depth:
        if source[cursor] == '{':
            depth += 1
        elif source[cursor] == '}':
            depth -= 1
        cursor += 1
    return source[start:cursor]


class RewardedEntryRouteTest(unittest.TestCase):
    @unittest.skipUnless(shutil.which('swiftc'), 'Native Swift execution requires the Mac build runner')
    def test_real_native_policy_accepts_only_exact_entry_games_and_trusted_document(self):
        source = (ROOT / 'ios/RewardedPreview/RewardedAdCoordinator.swift').read_text(encoding='utf-8')
        methods = '\n'.join(method(source, name) for name in ('isTrustedDocument', 'routePath', 'surface'))
        program = 'import Foundation\nstruct Policy {\n' + methods + '\n}\n' + r'''
let games = ["badeeha", "beep", "mamnoo", "jabeen", "fabraka", "meenfina", "ersomha", "mafia"]
for game in games {
    for suffix in ["", "?from=home"] {
        let url = URL(string: "maydan://app/#/entry/" + game + suffix)!
        precondition(Policy.surface(url) == "game-entry", "Valid entry blocked")
    }
}
for fragment in ["/", "/settings", "/entry", "/entry/unknown", "/entry/mafia/extra", "/entry/MAFIA", "/entry/%6daf ia", "/entry/%6dafia", "/room/12345", "/room/1234567"] {
    if let url = URL(string: "maydan://app/#" + fragment) {
        precondition(Policy.surface(url) == nil, "Nonentry route accepted")
    }
}
for address in ["https://app/#/entry/mafia", "maydan://evil/#/entry/mafia", "maydan://user@app/#/entry/mafia", "maydan://app:443/#/entry/mafia", "maydan://app/elsewhere#/entry/mafia", "maydan://app/?unsafe=1#/entry/mafia"] {
    precondition(Policy.surface(URL(string: address)!) == nil, "Untrusted document accepted")
}
precondition(Policy.surface(URL(string: "maydan://app/#/play/beep")!) == "local-start")
precondition(Policy.surface(URL(string: "maydan://app/#/online/mafia")!) == "selection")
precondition(Policy.surface(URL(string: "maydan://app/#/room/123456")!) == "room-lobby")
print("Exact native entry policy passed")
'''
        with tempfile.TemporaryDirectory(prefix='maydan-rewarded-route-') as directory:
            temporary = Path(directory)
            script, binary = temporary / 'entry.swift', temporary / 'entry-test'
            script.write_text(program, encoding='utf-8')
            compile_result = subprocess.run([shutil.which('swiftc'), str(script), '-o', str(binary)],
                                            capture_output=True, text=True, timeout=90)
            self.assertEqual(compile_result.returncode, 0, compile_result.stderr)
            result = subprocess.run([str(binary)], capture_output=True, text=True, timeout=15)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn('Exact native entry policy passed', result.stdout)


if __name__ == '__main__':
    unittest.main()
