// Play entry: everything Business has, plus /play. All Play code lives under this folder and is only
// reachable from this file, so the Business build cannot contain it.
import { mount } from '../app';
import { Play } from './Play';
import '../tokens.css';
import './play.css';

mount('/play', [{ path: '/play', element: <Play /> }]);
