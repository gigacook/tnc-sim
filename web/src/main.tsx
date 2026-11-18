// Business entry (also the default web app that tnc-server hosts): the machine workspace at /work, the
// signed-in pages when a server answers. Nothing under ./play is imported from here; tests/e2e/business-isolation.mjs proves it.
import { mount } from './app';

mount('/work');
