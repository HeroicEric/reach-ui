////////////////////////////////////////////////////////////////////////////////
// Welcome to @reach/tooltip!
//
// Quick definitions:
//
// - "on rest" or "rested on": describes when the element receives mouse hover
//   after a short delay (and hopefully soon, touch longpress).
//
// - "activation": describes a mouse click, keyboard enter, or keyboard space.
//
// Only one tooltip can be visible at a time, so we use a global state chart to
// describe the various states and transitions between states that are
// possible. With all the timeouts involved with tooltips it's important to
// "make impossible states impossible" with a state machine.
//
// It's also okay to use these module globals because you don't server render
// tooltips. None of the state is changed outside of user events.
//
// There are a few features that are important to understand.
//
// 1. Tooltips don't show up until the user has rested on one, we don't
//    want tooltips popupping up as you move your mouse around the page.
//
// 2. Once any tooltip becomes visible, other tooltips nearby should skip
//    resting and display immediately.
//
// 3. Tooltips stick around for a little bit after blur/mouseleave.
//
// TODO: Research longpress tooltips on Android, iOS
// - Probably want to position it by default above, since your thumb
//   is below and would cover it
// - I'm thinking after longpress, display the tooltip and cancel any click
//   events. Then on touchend, so they can read it display the tooltip for
//   a little while longer in case their hand was obstructing the tooltip.

/* eslint-disable default-case */

import React, {
  Fragment,
  cloneElement,
  Children,
  useState,
  useRef,
  forwardRef,
  useEffect
} from "react";
import { useId } from "@reach/auto-id";
import { wrapEvent, checkStyles, useForkedRef, makeId } from "@reach/utils";
import Portal from "@reach/portal";
import VisuallyHidden from "@reach/visually-hidden";
import { useRect } from "@reach/rect";
import PropTypes from "prop-types";

////////////////////////////////////////////////////////////////////////////////
// ~The states~

// nothing goin' on
const IDLE = "idle";

// we're considering showing the tooltip, but we're gonna wait a sec
const FOCUSED = "focused";

// IT'S ON
const VISIBLE = "visible";

// Focus has left, but we want to keep it visible for a sec
const LEAVING_VISIBLE = "leavingVisible";

// The user clicked the tool, so we want to hide the thing, we can't just use
// IDLE because we need to ignore mousemove, etc.
const DISMISSED = "dismissed";

const chart = {
  initial: IDLE,
  states: {
    [IDLE]: {
      enter: clearContextId,
      on: {
        mouseenter: FOCUSED,
        focus: VISIBLE
      }
    },
    [FOCUSED]: {
      enter: startRestTimer,
      leave: clearRestTimer,
      on: {
        mousemove: FOCUSED,
        mouseleave: IDLE,
        mousedown: DISMISSED,
        blur: IDLE,
        rest: VISIBLE
      }
    },
    [VISIBLE]: {
      on: {
        focus: FOCUSED,
        mouseenter: FOCUSED,
        mouseleave: LEAVING_VISIBLE,
        blur: LEAVING_VISIBLE,
        mousedown: DISMISSED,
        selectWithKeyboard: DISMISSED,
        globalMouseMove: LEAVING_VISIBLE
      }
    },
    [LEAVING_VISIBLE]: {
      enter: startLeavingVisibleTimer,
      leave: () => {
        clearLeavingVisibleTimer();
        clearContextId();
      },
      on: {
        mouseenter: VISIBLE,
        focus: VISIBLE,
        timecomplete: IDLE
      }
    },
    [DISMISSED]: {
      leave: () => {
        // allows us to come on back later w/o entering something else first
        context.id = null;
      },
      on: {
        mouseleave: IDLE,
        blur: IDLE
      }
    }
  }
};

// chart context allows us to persist some data around, in Tooltip all we use
// is the id of the current tooltip being interacted with.
let context = { id: null };
let state = chart.initial;

////////////////////////////////////////////////////////////////////////////////
// Finds the next state from the current state + action. If the chart doesn't
// describe that transition, it will throw.
//
// It also manages lifecycles of the machine, (enter/leave hooks on the state
// chart)
function transition(action, newContext) {
  const stateDef = chart.states[state];
  const nextState = stateDef.on[action];

  // Really useful for debugging
  // console.log({ action, state, nextState, contextId: context.id });
  // !nextState && console.log('no transition taken')

  if (!nextState) {
    return;
  }

  if (stateDef.leave) {
    stateDef.leave();
  }

  if (newContext) {
    context = newContext;
  }

  const nextDef = chart.states[nextState];
  if (nextDef.enter) {
    nextDef.enter();
  }

  state = nextState;
  notify();
}

////////////////////////////////////////////////////////////////////////////////
// Subscriptions:
//
// We could require apps to render a <TooltipProvider> around the app and use
// React context to notify Tooltips of changes to our state machine, instead
// we manage subscriptions ourselves and simplify the Tooltip API.
//
// Maybe if default context could take a hook (instead of just a static value)
// that was rendered at the root for us, that'd be cool! But it doesn't.
const subscriptions = [];

function subscribe(fn) {
  subscriptions.push(fn);
  return () => {
    subscriptions.splice(subscriptions.indexOf(fn), 1);
  };
}

function notify() {
  subscriptions.forEach(fn => fn(state, context));
}

////////////////////////////////////////////////////////////////////////////////
// Timeouts:

// Manages when the user "rests" on an element. Keeps the interface from being
// flashing tooltips all the time as the user moves the mouse around the screen.
let restTimeout;

function startRestTimer() {
  clearTimeout(restTimeout);
  restTimeout = setTimeout(() => transition("rest"), 100);
}

function clearRestTimer() {
  clearTimeout(restTimeout);
}

// Manages the delay to hide the tooltip after rest leaves.
let leavingVisibleTimer;

function startLeavingVisibleTimer() {
  clearTimeout(leavingVisibleTimer);
  leavingVisibleTimer = setTimeout(() => transition("timecomplete"), 500);
}

function clearLeavingVisibleTimer() {
  clearTimeout(leavingVisibleTimer);
}

// allows us to come on back later w/o entering something else first after the
// user leaves or dismisses
function clearContextId() {
  context.id = null;
}

////////////////////////////////////////////////////////////////////////////////
// useTooltip

export function useTooltip({
  id: idProp,
  onMouseEnter,
  onMouseMove,
  onMouseLeave,
  onFocus,
  onBlur,
  onKeyDown,
  onMouseDown,
  ref: forwardedRef,
  DEBUG_STYLE
} = {}) {
  const id = useId(idProp);

  const [isVisible, setIsVisible] = useState(
    DEBUG_STYLE
      ? true
      : id === null
      ? false
      : context.id === id && state === VISIBLE
  );

  // hopefully they always pass a ref if they ever pass one
  const ownRef = useRef();
  const ref = useForkedRef(forwardedRef, ownRef);
  const triggerRect = useRect(ownRef, isVisible);

  useEffect(() => {
    return subscribe(() => {
      if (
        context.id === id &&
        (state === VISIBLE || state === LEAVING_VISIBLE)
      ) {
        setIsVisible(true);
      } else {
        setIsVisible(false);
      }
    });
  }, [id]);

  useEffect(() => checkStyles("tooltip"));

  useEffect(() => {
    const listener = event => {
      if (
        (event.key === "Escape" || event.key === "Esc") &&
        state === VISIBLE
      ) {
        transition("selectWithKeyboard");
      }
    };
    document.addEventListener("keydown", listener);
    return () => document.removeEventListener("keydown", listener);
  }, []);

  const handleMouseEnter = () => {
    transition("mouseenter", { id });
  };

  const handleMouseMove = () => {
    transition("mousemove", { id });
  };

  const handleFocus = event => {
    if (window.__REACH_DISABLE_TOOLTIPS) return;
    transition("focus", { id });
  };

  const handleMouseLeave = () => {
    transition("mouseleave");
  };

  const handleBlur = () => {
    // Allow quick click from one tool to another
    if (context.id !== id) return;
    transition("blur");
  };

  const handleMouseDown = () => {
    // Allow quick click from one tool to another
    if (context.id !== id) return;
    transition("mousedown");
  };

  const handleKeyDown = event => {
    if (event.key === "Enter" || event.key === " ") {
      transition("selectWithKeyboard");
    }
  };

  const trigger = {
    "aria-describedby": isVisible ? makeId("tooltip", id) : undefined,
    "data-reach-tooltip-trigger": "",
    ref,
    onMouseEnter: wrapEvent(onMouseEnter, handleMouseEnter),
    onMouseMove: wrapEvent(onMouseMove, handleMouseMove),
    onFocus: wrapEvent(onFocus, handleFocus),
    onBlur: wrapEvent(onBlur, handleBlur),
    onMouseLeave: wrapEvent(onMouseLeave, handleMouseLeave),
    onKeyDown: wrapEvent(onKeyDown, handleKeyDown),
    onMouseDown: wrapEvent(onMouseDown, handleMouseDown)
  };

  const tooltip = {
    id,
    triggerRect,
    isVisible
  };

  return [trigger, tooltip, isVisible];
}

////////////////////////////////////////////////////////////////////////////////
// Tooltip

export function Tooltip({
  children,
  label,
  ariaLabel,
  id,
  DEBUG_STYLE,
  ...rest
}) {
  const child = Children.only(children);

  // We need to pass some properties from the child into useTooltip
  // to make sure users can maintain control over the trigger's ref and events
  const [trigger, tooltip] = useTooltip({
    id,
    onMouseEnter: child.props.onMouseEnter,
    onMouseMove: child.props.onMouseMove,
    onMouseLeave: child.props.onMouseLeave,
    onFocus: child.props.onFocus,
    onBlur: child.props.onBlur,
    onKeyDown: child.props.onKeyDown,
    onMouseDown: child.props.onMouseDown,
    ref: child.ref,
    DEBUG_STYLE
  });
  return (
    <Fragment>
      {cloneElement(child, trigger)}
      <TooltipPopup
        label={label}
        ariaLabel={ariaLabel}
        {...tooltip}
        {...rest}
      />
    </Fragment>
  );
}

Tooltip.displayName = "Tooltip";
if (__DEV__) {
  Tooltip.propTypes = {
    children: PropTypes.node.isRequired,
    label: PropTypes.node.isRequired,
    ariaLabel: PropTypes.string
  };
}

export default Tooltip;

////////////////////////////////////////////////////////////////////////////////
// TooltipPopup

export const TooltipPopup = forwardRef(function TooltipPopup(
  {
    // own props
    label, // could use children but want to encourage simple strings
    ariaLabel,
    position,

    // hook spread props
    isVisible,
    id,
    triggerRect,
    ...rest
  },
  forwardRef
) {
  return isVisible ? (
    <Portal>
      <TooltipContent
        label={label}
        ariaLabel={ariaLabel}
        position={position}
        isVisible={isVisible}
        id={makeId("tooltip", id)}
        triggerRect={triggerRect}
        ref={forwardRef}
        {...rest}
      />
    </Portal>
  ) : null;
});

TooltipPopup.displayName = "TooltipPopup";
if (__DEV__) {
  TooltipPopup.propTypes = {
    label: PropTypes.node.isRequired,
    ariaLabel: PropTypes.string,
    position: PropTypes.func
  };
}

////////////////////////////////////////////////////////////////////////////////
// TooltipContent
// Need a separate component so that useRect works inside the portal

const TooltipContent = forwardRef(function TooltipContent(
  {
    label,
    ariaLabel,
    position = positionDefault,
    isVisible,
    id,
    triggerRect,
    style,
    ...rest
  },
  forwardedRef
) {
  const useAriaLabel = ariaLabel != null;
  const ownRef = useRef(null);
  const ref = useForkedRef(forwardedRef, ownRef);
  const tooltipRect = useRect(ownRef, isVisible);
  return (
    <Fragment>
      <div
        data-reach-tooltip
        role={useAriaLabel ? undefined : "tooltip"}
        id={useAriaLabel ? undefined : id}
        children={label}
        style={{
          ...style,
          ...getStyles(position, triggerRect, tooltipRect)
        }}
        ref={ref}
        {...rest}
      />
      {useAriaLabel && (
        <VisuallyHidden role="tooltip" id={id}>
          {ariaLabel}
        </VisuallyHidden>
      )}
    </Fragment>
  );
});

TooltipContent.displayName = "TooltipContent";
if (__DEV__) {
  TooltipContent.propTypes = {};
}

////////////////////////////////////////////////////////////////////////////////

// feels awkward when it's perfectly aligned w/ the trigger
const OFFSET = 8;

function getStyles(position, triggerRect, tooltipRect) {
  const haventMeasuredTooltipYet = !tooltipRect;
  if (haventMeasuredTooltipYet) {
    return { visibility: "hidden" };
  }
  return position(triggerRect, tooltipRect);
}

function positionDefault(triggerRect, tooltipRect) {
  const collisions = {
    top: triggerRect.top - tooltipRect.height < 0,
    right: window.innerWidth < triggerRect.left + tooltipRect.width,
    bottom:
      window.innerHeight < triggerRect.bottom + tooltipRect.height + OFFSET,
    left: triggerRect.left - tooltipRect.width < 0
  };

  const directionRight = collisions.right && !collisions.left;
  const directionUp = collisions.bottom && !collisions.top;

  return {
    left: directionRight
      ? `${triggerRect.right - tooltipRect.width + window.pageXOffset}px`
      : `${triggerRect.left + window.pageXOffset}px`,
    top: directionUp
      ? `${triggerRect.top -
          OFFSET -
          tooltipRect.height +
          window.pageYOffset}px`
      : `${triggerRect.top +
          OFFSET +
          triggerRect.height +
          window.pageYOffset}px`
  };
}
