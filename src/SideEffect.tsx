import * as React from 'react';
import { TouchEvent } from 'react';
import { RemoveScrollBar } from 'react-remove-scroll-bar';
import { styleSingleton } from 'react-style-singleton';

import { nonPassive } from './aggresiveCapture';
import { handleScroll, locationCouldBeScrolled } from './handleScroll';
import { Axis, IRemoveScrollEffectProps } from './types';

export const getTouchXY = (event: TouchEvent | WheelEvent) =>
  'changedTouches' in event ? [event.changedTouches[0].clientX, event.changedTouches[0].clientY] : [0, 0];

export const getDeltaXY = (event: WheelEvent) => [event.deltaX, event.deltaY];

const extractRef = (ref: React.RefObject<any> | HTMLElement): HTMLElement =>
  ref && 'current' in ref ? ref.current : ref;

const deltaCompare = (x: number[], y: number[]) => x[0] === y[0] && x[1] === y[1];

const generateStyle = (id: number) => `
  .block-interactivity-${id} {pointer-events: none;}
  .allow-interactivity-${id} {pointer-events: all;}
`;

let idCounter = 0;
let lockStack: any[] = [];

export function RemoveScrollSideCar(props: IRemoveScrollEffectProps) {
  const shouldPreventQueue = React.useRef<Array<{ name: string; delta: number[]; target: any; should: boolean }>>([]);
  const touchStartRef = React.useRef([0, 0]);
  const activeAxis = React.useRef<Axis | undefined>();
  const [id] = React.useState(idCounter++);
  const [Style] = React.useState(styleSingleton);
  const lastProps = React.useRef<IRemoveScrollEffectProps>(props);

  React.useEffect(() => {
    lastProps.current = props;
  }, [props]);

  React.useEffect(() => {
    if (props.inert) {
      document.body.classList.add(`block-interactivity-${id}`);

      const allow = [props.lockRef.current, ...(props.shards || []).map(extractRef)].filter(Boolean);
      allow.forEach((el) => el!.classList.add(`allow-interactivity-${id}`));

      return () => {
        document.body.classList.remove(`block-interactivity-${id}`);
        allow.forEach((el) => el!.classList.remove(`allow-interactivity-${id}`));
      };
    }

    return;
  }, [props.inert, props.lockRef.current, props.shards]);

  const shouldCancelEvent = React.useCallback((event: WheelEvent | TouchEvent, parent: HTMLElement) => {
    if ('touches' in event && event.touches.length === 2) {
      return !lastProps.current.allowPinchZoom;
    }

    const touch = getTouchXY(event);
    const touchStart = touchStartRef.current;
    const deltaX = 'deltaX' in event ? event.deltaX : touchStart[0] - touch[0];
    const deltaY = 'deltaY' in event ? event.deltaY : touchStart[1] - touch[1];

    let currentAxis: Axis | undefined;
    const target: HTMLElement = event.target as any;

    const moveDirection: Axis = Math.abs(deltaX) > Math.abs(deltaY) ? 'h' : 'v';

    // allow horizontal touch move on Range inputs. They will not cause any scroll
    if ('touches' in event && moveDirection === 'h' && (target as HTMLInputElement).type === 'range') {
      return false;
    }

    let canBeScrolledInMainDirection = locationCouldBeScrolled(moveDirection, target);

    if (!canBeScrolledInMainDirection) {
      return true;
    }

    if (canBeScrolledInMainDirection) {
      currentAxis = moveDirection;
    } else {
      currentAxis = moveDirection === 'v' ? 'h' : 'v';
      canBeScrolledInMainDirection = locationCouldBeScrolled(moveDirection, target);
      // other axis might be not scrollable
    }

    if (!canBeScrolledInMainDirection) {
      return false;
    }

    if (!activeAxis.current && 'changedTouches' in event && (deltaX || deltaY)) {
      activeAxis.current = currentAxis;
    }

    if (!currentAxis) {
      return true;
    }

    const cancelingAxis = activeAxis.current || currentAxis;

    return handleScroll(cancelingAxis, parent, event, cancelingAxis === 'h' ? deltaX : deltaY, true);
  }, []);

  const shouldPrevent = React.useCallback((subscriberElement: Document | ShadowRoot) => (_event: Event) => {
    const event: WheelEvent | TouchEvent = _event as any;

    if (!lockStack.length || lockStack[lockStack.length - 1] !== Style) {
      // not the last active
      return;
    }

    const delta = 'deltaY' in event ? getDeltaXY(event) : getTouchXY(event);
    const sourceEvent = shouldPreventQueue.current.filter(
      (e) => e.name === event.type && e.target === event.target && deltaCompare(e.delta, delta)
    )[0];

    // self event, and should be canceled
    if (sourceEvent && sourceEvent.should) {
      if (event.cancelable) {
        event.preventDefault();
      }

      return;
    }

    const shouldPreventQueueContainsEventButSubscriberDoesntContainTarget = shouldPreventQueue.current.some((e) => e.name === event.type && deltaCompare(e.delta, delta) && !subscriberElement.contains(e.target))

    // outside or shard event
    if (!sourceEvent && !shouldPreventQueueContainsEventButSubscriberDoesntContainTarget) {
      const shardNodes = (lastProps.current.shards || [])
        .map(extractRef)
        .filter(Boolean)
        .filter((node) => node.contains(event.target as any));

      const shouldStop =
        shardNodes.length > 0 ? shouldCancelEvent(event, shardNodes[0]) : !lastProps.current.noIsolation;

      if (shouldStop) {
        if (event.cancelable) {
          event.preventDefault();
        }
      }
    }
  }, []);

  const shouldCancel = React.useCallback((name: string, delta: number[], target: any, should: boolean) => {
    const event = { name, delta, target, should };
    shouldPreventQueue.current.push(event);

    setTimeout(() => {
      shouldPreventQueue.current = shouldPreventQueue.current.filter((e) => e !== event);
    }, 1);
  }, []);

  const scrollTouchStart = React.useCallback((event: any) => {
    touchStartRef.current = getTouchXY(event);
    activeAxis.current = undefined;
  }, []);

  const scrollWheel = React.useCallback((event: WheelEvent) => {
    shouldCancel(event.type, getDeltaXY(event), event.target, shouldCancelEvent(event, props.lockRef.current as any));
  }, []);

  const scrollTouchMove = React.useCallback((event: TouchEvent<HTMLDivElement>) => {
    shouldCancel(event.type, getTouchXY(event), event.target, shouldCancelEvent(event, props.lockRef.current as any));
  }, []);

  React.useEffect(() => {
    lockStack.push(Style);

    props.setCallbacks({
      onScrollCapture: scrollWheel,
      onWheelCapture: scrollWheel,
      onTouchMoveCapture: scrollTouchMove,
    });

    const documentAndShadowRootsSubscribers = [document, ...getShadowRootsInNode(document)].map(documentOrShadowRoot => ({
      shouldPrevent: shouldPrevent(documentOrShadowRoot),
      scrollTouchStart: scrollTouchStart,
      elementToSubscribeTo: documentOrShadowRoot,
    }));

    documentAndShadowRootsSubscribers.forEach(({ shouldPrevent, scrollTouchStart, elementToSubscribeTo }) => {
      elementToSubscribeTo.addEventListener('wheel', shouldPrevent, nonPassive);
      elementToSubscribeTo.addEventListener('touchmove', shouldPrevent, nonPassive);
      elementToSubscribeTo.addEventListener('touchstart', scrollTouchStart, nonPassive);
    })


    return () => {
      lockStack = lockStack.filter((inst) => inst !== Style);

      documentAndShadowRootsSubscribers.forEach(({ shouldPrevent, scrollTouchStart, elementToSubscribeTo }) => {
        elementToSubscribeTo.removeEventListener('wheel', shouldPrevent, nonPassive as any);
        elementToSubscribeTo.removeEventListener('touchmove', shouldPrevent, nonPassive as any);
        elementToSubscribeTo.removeEventListener('touchstart', scrollTouchStart, nonPassive as any);
      });
    };
  }, []);

  const { removeScrollBar, inert } = props;

  return (
    <React.Fragment>
      {inert ? <Style styles={generateStyle(id)} /> : null}
      {removeScrollBar ? <RemoveScrollBar gapMode={props.gapMode} /> : null}
    </React.Fragment>
  );
}

function getShadowRootsInNode(node: Node): ShadowRoot[] {
  const shadowRoots: ShadowRoot[] = [];
  walkNodeTree(node, node => (node as HTMLElement).shadowRoot && shadowRoots.push((node as HTMLElement).shadowRoot!));

  return shadowRoots;
}

function walkNodeTree(node: Node, cb: (node: Node) => void) {
  cb(node);
  node.childNodes.forEach(node => walkNodeTree(node, cb));
  const maybeShadowRoot = (node as HTMLElement).shadowRoot;

  if (maybeShadowRoot) {
    maybeShadowRoot.childNodes.forEach(node => walkNodeTree(node, cb));
  }
}
