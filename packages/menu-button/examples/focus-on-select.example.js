import "@reach/menu-button/styles.css";

import React, { useRef } from "react";
import { action } from "@storybook/addon-actions";
import { Menu, MenuList, MenuButton, MenuItem } from "@reach/menu-button";

export let name = "Move Focus on Item Select";

export let Example = () => {
  const [buttonText, setButtonText] = React.useState(null);
  const [linkText, setLinkText] = React.useState(null);
  const linkRef = useRef(null);
  return (
    <div>
      <p>
        When a menu is closed by escaping or selecting a menu item, the menu
        button should typically receive focus.
      </p>
      <p>
        However you may want a menu item to move the user to another part of
        your UI and move focus along with it.
      </p>
      <Menu>
        <MenuButton
          onFocus={() => setButtonText("Focused! ")}
          onBlur={() => setButtonText(null)}
          id="example-button"
        >
          {buttonText}
          Actions <span aria-hidden="true">▾</span>
        </MenuButton>
        <MenuList>
          <MenuItem
            onSelect={() => {
              linkRef.current.focus();
              action("Select Google Link");
            }}
          >
            Select Google Link
          </MenuItem>
          <MenuItem onSelect={action("Close and Focus Button")}>
            Close and Focus Button
          </MenuItem>
        </MenuList>
      </Menu>
      <hr />
      <a
        href="https://google.com"
        target="_blank"
        rel="noopener noreferrer"
        ref={linkRef}
        onFocus={() => setLinkText("Focused! ")}
        onBlur={() => setLinkText(null)}
      >
        {linkText}
        Go to Google
      </a>
    </div>
  );
};
