export {};

jest.mock('react-native', () => ({
  Platform: { OS: 'android' },
  View: 'View',
  Modal: 'Modal',
  StyleSheet: { create: (value: unknown) => value, absoluteFillObject: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 } },
  BackHandler: { addEventListener: jest.fn(() => ({ remove: jest.fn() })) },
  useWindowDimensions: () => ({ width: 400, height: 800 }),
}));

const React = require('react');
const { create, act } = require('react-test-renderer');
const { Platform, BackHandler } = require('react-native');
const { AndroidOverlayProvider } = require('../AndroidOverlayHost');
const ModalOverlay = require('../ModalOverlay').default;
const h = React.createElement;

beforeEach(() => {
  Platform.OS = 'android';
  BackHandler.addEventListener.mockClear();
});

test('card menu escapes clipping, blocks the background, updates, and cleans up on unmount', () => {
  const screen = (visible: boolean, label = 'First client') => h(AndroidOverlayProvider, null,
    h('View', { testID: 'card', style: { overflow: 'hidden', height: 100 } },
      visible && h(ModalOverlay, { visible: true, escapeParent: true, onClose: jest.fn() },
        h('Menu', { label }))));
  let renderer: any;
  act(() => { renderer = create(screen(true)); });
  expect(renderer.root.findByProps({ testID: 'card' }).findAllByType('Menu')).toHaveLength(0);
  expect(renderer.root.findByType('Menu').props.label).toBe('First client');
  expect(renderer.root.findAllByProps({ importantForAccessibility: 'no-hide-descendants' })).toHaveLength(1);
  act(() => { renderer.update(screen(true, 'Second client')); });
  expect(renderer.root.findAllByType('Menu')).toHaveLength(1);
  expect(renderer.root.findByType('Menu').props.label).toBe('Second client');
  act(() => { renderer.update(screen(false)); });
  expect(renderer.root.findAllByType('Menu')).toHaveLength(0);
  expect(renderer.root.findAllByProps({ importantForAccessibility: 'no-hide-descendants' })).toHaveLength(0);
  act(() => { renderer.unmount(); });
});

test('Android Back dismisses a hosted menu and removes its overlay', () => {
  function Screen() {
    const [visible, setVisible] = React.useState(true);
    return h(AndroidOverlayProvider, null,
      h(ModalOverlay, { visible, escapeParent: true, onClose: () => setVisible(false) }, h('Menu')));
  }
  let renderer: any;
  act(() => { renderer = create(h(Screen)); });
  const onBack = BackHandler.addEventListener.mock.calls[0][1];
  act(() => { expect(onBack()).toBe(true); });
  expect(renderer.root.findAllByType('Menu')).toHaveLength(0);
  act(() => { renderer.unmount(); });
});

test('iOS keeps its native modal, dimensions and request-close callback', () => {
  Platform.OS = 'ios';
  const onClose = jest.fn();
  let renderer: any;
  act(() => { renderer = create(h(AndroidOverlayProvider, null,
    h(ModalOverlay, { visible: true, escapeParent: true, onClose, animationType: 'fade' }, h('Menu')))); });
  const modal = renderer.root.findByType('Modal');
  expect(modal.props).toMatchObject({ visible: true, transparent: true, animationType: 'fade', onRequestClose: onClose });
  expect(modal.findByType('View').props.style).toContainEqual({ width: 400, height: 800 });
  expect(BackHandler.addEventListener).not.toHaveBeenCalled();
  act(() => { renderer.unmount(); });
});
