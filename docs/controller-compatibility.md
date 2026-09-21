# Controller Compatibility

This document tracks Bluetooth controller compatibility with the BC-250 Bluetooth Power Controller.

The wake system does **not** pair with controllers and does not act as a Bluetooth adapter. It passively watches for Bluetooth LE advertisements from saved controller addresses while the BC-250 is off.

That means compatibility depends on how a controller advertises when it is powered on, not simply on whether the controller works with Bazzite or Linux.

---

## Compatibility status

### Tested and working

| Controller | Wake works | Web scanner identification | Gameplay pairing | Notes |
|---|---|---|---|---|
| Xbox Elite Wireless Controller Series 2 | Yes | Yes | Yes | Tested end-to-end. Controller advertisements reliably wake the BC-250, then the controller reconnects normally to Bazzite. |

The tested controller advertised as:

```text
Xbox Wireless Controller
```

and was identified by the scanner as a likely controller using its advertised name, HID metadata, and gamepad-related advertisement data.

---

## What makes a controller compatible

A controller is a good wake candidate if it:

1. uses Bluetooth LE advertisements when powered on
2. exposes a BLE address the ESP can observe
3. continues using an address that can be matched later
4. emits enough advertisements during startup for the wake filter to confirm it
5. appears above the configured RSSI threshold

The default wake filter is:

```python
WAKE_RSSI_MIN = -85
WAKE_HITS_REQUIRED = 2
WAKE_HIT_WINDOW_MS = 1500
```

The ESP does not need to establish a Bluetooth connection.

---

## What does **not** matter for wake compatibility

The ESP does not care whether the controller:

- is paired to the XIAO
- supports XInput
- supports Steam Input
- is recognized by Linux as a gamepad
- exposes every normal BLE HID characteristic
- reconnects to the BC-250 immediately after wake

Those properties matter for gameplay, but the wake controller only needs a usable BLE advertisement.

---

## Likely compatibility categories

These categories describe **expected behavior**, not confirmed compatibility unless a specific model appears in the tested table above.

### Xbox Bluetooth controllers

Modern Xbox controllers that advertise over Bluetooth are good candidates.

Examples may include:

- Xbox Wireless Controller
- Xbox Elite Wireless Controller Series 2

The Elite Series 2 is confirmed working.

Controllers using only the proprietary Xbox Wireless radio and not Bluetooth will not work as BLE wake sources.

---

### PlayStation controllers

Controllers such as:

- DualSense
- DualShock 4

are plausible candidates if their startup advertisements expose a stable address that the ESP can match.

These are **not yet confirmed** by this project unless added to the tested table.

---

### 8BitDo / GameSir / third-party Bluetooth controllers

Many third-party controllers advertise over BLE and may work well.

The web UI recognizes several common controller-name patterns, including:

- 8BitDo
- GameSir
- Gamepad
- Wireless Controller

However, name recognition only helps discovery. Wake compatibility still depends on address stability and advertisement behavior.

---

### Nintendo controllers

Joy-Con and Pro Controller naming is recognized by the web UI.

Actual wake compatibility has not yet been confirmed.

Some controller families may change behavior depending on pairing mode or host type.

---

## Common reasons a controller may not work

### Rotating / private BLE address

Some Bluetooth devices use private or rotating addresses.

Symptoms:

- controller appears in scans
- MAC address changes between sessions
- saved controller works once and then stops waking the system

If the address changes regularly, the current wake architecture cannot reliably identify that controller by MAC alone.

---

### No advertisement during power-on

A controller may support Bluetooth but not emit a useful advertisement when turned on.

It may instead:

- immediately reconnect using previously established state
- use a proprietary radio
- advertise only in pairing mode
- expose too little information for reliable detection

In that case, it may work perfectly in Bazzite but still be a poor wake source.

---

### RSSI too weak

If the controller is far from the ESP or the antenna is poorly positioned, advertisements may fall below:

```python
WAKE_RSSI_MIN
```

Use the web scanner to observe RSSI from normal playing distance before changing the threshold.

---

### Too few packets during startup

Wake requires more than one matching advertisement by default.

```python
WAKE_HITS_REQUIRED = 2
WAKE_HIT_WINDOW_MS = 1500
```

A controller that emits only a single short-lived packet may not satisfy the filter.

---

### Controller uses only proprietary wireless

A controller may work through:

- Xbox Wireless
- a 2.4 GHz USB dongle
- another vendor-specific radio

without emitting BLE advertisements suitable for this project.

That does not make the controller incompatible with the BC-250 as a game controller; it only makes it unsuitable as a BLE wake source.

---

## How to test a new controller

Use this process before adding a compatibility report.

### 1. Establish a baseline

With the controller off:

1. open the web UI
2. click **Scan**
3. wait for the scan to finish

---

### 2. Power on the controller

Turn the controller on normally.

Then immediately:

1. click **Scan** again
2. look for a **NEW** device
3. use **Controllers first** sorting

The scanner may identify the device using:

- advertised name
- HID service
- gamepad / joystick appearance
- manufacturer ID
- controller-name patterns

---

### 3. Save the controller

Add the discovered device to the wake-controller list.

Confirm the saved MAC matches the newly discovered entry.

---

### 4. Shut down the BC-250

Perform a normal software shutdown.

Wait until:

- PSU main rails turn off
- XIAO remains powered
- BLE wake scanning resumes

---

### 5. Test wake

Turn the controller on.

Record whether:

- PSU turns on
- BC-250 starts
- running sense is detected
- controller reconnects to Bazzite

---

### 6. Repeat the test

A controller should not be considered confirmed after one successful wake.

Test at least several cold/off-state wake cycles.

Also verify the MAC address stays consistent between sessions.

---

## Compatibility report template

When reporting a controller, include:

```text
Controller:
Manufacturer:
Advertised name:
BLE MAC stable across boots: Yes / No / Unknown
Scanner marks as likely controller: Yes / No
Wake result: Works / Intermittent / Does not work
Approximate RSSI at normal distance:
Gameplay reconnect after wake: Yes / No / Not tested
Notes:
```

Example:

```text
Controller: Xbox Elite Wireless Controller Series 2
Manufacturer: Microsoft
Advertised name: Xbox Wireless Controller
BLE MAC stable across boots: Yes
Scanner marks as likely controller: Yes
Wake result: Works
Approximate RSSI at normal distance: Strong enough for default -85 dBm threshold
Gameplay reconnect after wake: Yes
Notes: Tested repeatedly with Bazzite. Controller wakes system and reconnects normally after boot.
```

---

## Compatibility table format

As more controllers are tested, add them here.

| Controller | Manufacturer | Wake | Stable MAC | Scanner ID | Gameplay reconnect | Status |
|---|---|---|---|---|---|---|
| Xbox Elite Wireless Controller Series 2 | Microsoft | Yes | Yes | Yes | Yes | Confirmed |
| DualSense | Sony | Not tested | Unknown | Expected | Not tested | Untested |
| DualShock 4 | Sony | Not tested | Unknown | Expected | Not tested | Untested |
| 8BitDo controllers | 8BitDo | Not tested | Unknown | Expected | Not tested | Untested |
| GameSir Bluetooth controllers | GameSir | Not tested | Unknown | Expected | Not tested | Untested |
| Nintendo Pro Controller | Nintendo | Not tested | Unknown | Expected | Not tested | Untested |
| Joy-Con | Nintendo | Not tested | Unknown | Expected | Not tested | Untested |

`Expected` under Scanner ID means the current browser-side naming logic contains patterns that may recognize that family. It does **not** mean wake compatibility is confirmed.

---

## Scanner identification vs wake compatibility

These are separate things.

A controller can be identified perfectly in the web UI and still fail as a wake source.

For example:

```text
DualSense Wireless Controller
Sony
BLE HID
Likely controller
```

would mean the scanner understands what the device probably is.

It does **not** prove that:

- its MAC stays stable
- it advertises every time it powers on
- its advertisements are strong enough
- the wake filter sees enough packets

The compatibility table should therefore record actual wake testing separately from scanner identification.

---

## Non-controller BLE devices

The web UI intentionally does not restrict enrollment to game controllers.

Any discovered BLE address can be added to the wake list.

That means users can experiment with:

- phones
- watches
- remotes
- tags
- sensors
- other BLE gadgets

if they really want to.

The **Controllers first** sort mode exists to make normal setup easier, not to prevent unusual use cases.

---

## Current project recommendation

For a reliable living-room setup, use a controller that:

- advertises consistently when powered on
- keeps a stable BLE address
- appears strongly at couch distance
- reconnects normally to Bazzite after boot

At the time of the first release, the **Xbox Elite Wireless Controller Series 2** is the confirmed reference device.
