"""Reject preference-only and synthetic-geometry evidence; check runner isolation."""
from contextlib import redirect_stdout
import copy
import io
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import Mock, patch

from smoke_drawing_orientation import DrawingOrientationSmoke


class DrawingOrientationEvidenceTests(unittest.TestCase):
    @staticmethod
    def state(command='portrait', orientation=1, lease=None, generation=0):
        wide = orientation in (3, 4)
        return {'fixture':'drawing-orientation-lease', 'gameLoaded':True,
                'eligibilityInjected':True, 'geometryInjected':False, 'baselineRaw':1,
                'lastCommand':{'id':command, 'command':command}, 'orientationRaw':orientation,
                'landscape':wide, 'webWidth':667 if wide else 375, 'webHeight':375 if wide else 667,
                'lease':lease, 'generation':generation, 'supportedMask':24 if lease else 26,
                'edgeBackEnabled':not bool(lease)}

    def test_acceptance_requires_measured_geometry_and_view_dimensions(self):
        value = self.state('acquire-first', 3, 'ers-simulator-first', 1)
        self.assertTrue(DrawingOrientationSmoke.is_landscape(value, 'ers-simulator-first'))
        for change in [{'geometryInjected':True}, {'gameLoaded':False}, {'orientationRaw':1},
                       {'webWidth':375}, {'webWidth':float('nan')}, {'supportedMask':26}, {'lease':'ers-old'}, {'edgeBackEnabled':True}]:
            changed = copy.deepcopy(value); changed.update(change)
            self.assertFalse(DrawingOrientationSmoke.is_landscape(changed, 'ers-simulator-first'))
        self.assertTrue(DrawingOrientationSmoke.is_portrait(self.state()))
        changed = self.state(); changed['lease'] = 'ers-pending'
        self.assertFalse(DrawingOrientationSmoke.is_portrait(changed))

    def test_runner_saves_real_states_and_restores_environment(self):
        with tempfile.TemporaryDirectory() as temporary:
            folder = Path(temporary)
            smoke = DrawingOrientationSmoke(folder/'Maydan.app', folder/'evidence')
            smoke.prepare = Mock(); smoke.launch = Mock(side_effect=lambda *args: smoke.report['launches'].append({'pid':123}))
            data = folder/'data'; (data/'Documents/drawing-orientation-fixture').mkdir(parents=True)
            smoke.prepare_command = Mock(return_value=subprocess.CompletedProcess([], 0, str(data), ''))
            smoke.finish = Mock(); smoke.screenshot = Mock()
            values = [self.state(), self.state(), self.state('acquire-first',3,'ers-simulator-first',1),
                      self.state('acquire-next',3,'ers-simulator-next',2), self.state('release-stale',3,'ers-simulator-next',2),
                      self.state('release-current',1,None,3)]
            smoke.read_until = Mock(side_effect=copy.deepcopy(values))
            variable = 'SIMCTL_CHILD_MAYDAN_SIMULATOR_ORIENTATION'
            with patch.dict(os.environ, {variable:'previous'}), redirect_stdout(io.StringIO()):
                self.assertEqual(smoke.run(), 0)
                self.assertEqual(os.environ[variable], 'previous')
            self.assertEqual(smoke.report['drawingOrientation']['restoredOrientation'], 1)
            self.assertFalse(smoke.report['drawingOrientation']['geometryInjected'])
            self.assertFalse(smoke.report['drawingOrientation']['physicalDeviceTest'])
            self.assertFalse(smoke.report['drawingOrientation']['productionRoomJoined'])
            self.assertTrue(smoke.report['drawingOrientation']['staleReleaseIgnored'])
            self.assertEqual(len(list(smoke.output.glob('*.json'))), 5)

if __name__ == '__main__':
    unittest.main()
