"""Failed mounted-button assertions must retain the actual measured evidence."""
from contextlib import redirect_stdout
import io
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import Mock

from smoke_app_update_gate import UpdateGateSmoke


class UpdateGateEvidenceTests(unittest.TestCase):
    def test_failed_button_preserves_measurements_before_assertion(self):
        for changed in ({'width': 0}, {'height': 0}, {'accessible': False}, {'accessibilityLabel': ''}, {'buttonTrait': False}):
            with self.subTest(changed=changed), tempfile.TemporaryDirectory() as temporary:
                folder = Path(temporary)
                smoke = UpdateGateSmoke(folder / 'Maydan.app', folder / 'evidence')
                smoke.device, smoke.bundle = 'owned-simulator', 'Maydan'
                smoke.prepare = Mock()
                smoke.launch = Mock(side_effect=lambda *args: smoke.report['launches'].append({'pid': 123}))
                smoke.simctl = Mock(return_value=subprocess.CompletedProcess([], 0, str(folder / 'data'), ''))
                smoke.finish = Mock()
                button = {'title': 'تحديث من App Store', 'hidden': False, 'enabled': True, 'width': 319, 'height': 52,
                          'accessible': True, 'accessibilityLabel': 'تحديث ميدان من متجر التطبيقات', 'buttonTrait': True}
                button.update(changed)
                state = {'blocked': True, 'initialLoadPermitted': False, 'panel': {
                    'mounted': True, 'heading': 'تحديث ميدان مطلوب', 'message': 'يتوفر تحديث مطلوب لميدان. حدّث التطبيق للمتابعة.',
                    'modalAccessibility': True, 'update': button}}
                smoke.read_until = Mock(return_value=state)
                with redirect_stdout(io.StringIO()):
                    self.assertEqual(smoke.run(), 1)
                self.assertFalse(smoke.report['passed'])
                self.assertEqual(json.loads((smoke.output / 'required-view.json').read_text(encoding='utf-8')), state)
                self.assertIn(json.dumps(button, ensure_ascii=False, sort_keys=True), smoke.report['error'])


if __name__ == '__main__':
    unittest.main()
