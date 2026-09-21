# Wiring Guide

This document covers the **tested logical wiring arrangement** for the BC-250 Bluetooth Power Controller using a **Seeed Studio XIAO ESP32-C3**.

The ESP is powered continuously from the PSU's standby supply, controls the PSU's main-power enable line through an external transistor interface, emulates the BC-250 motherboard power button through a second transistor interface, reads a BC-250 running-state signal, and reads a physical case button.

> **Important:** This project directly interfaces with PC power-control signals. Verify your own PSU pinout, voltage levels, transistor orientation, grounding, and BC-250 signal behavior before connecting anything.

---

## Tested pin mapping

| Function | XIAO pin | ESP32-C3 GPIO | Direction | Description |
|---|---:|---:|---|---|
| BC-250 power-button control | D0 | GPIO2 | Output | Pulses the BC-250 power-button interface |
| BC-250 running sense | D1 | GPIO3 | Input | Reads whether the BC-250 is running |
| Physical case button | D2 | GPIO4 | Input / pull-up | Reads the local front-panel button |
| PSU PS_ON control | D3 | GPIO5 | Output | Enables PSU main power through a transistor interface |
| Standby power | 5V | — | Power | Keeps the XIAO alive while the BC-250 is off |
| Common reference | GND | — | Ground | Shared logic ground |

The default firmware configuration is:

```python
PIN_BC250_BUTTON = 2
PIN_BC250_SENSE = 3
PIN_CASE_BUTTON = 4
PIN_PS_ON = 5
```

---

## High-level architecture

```text
                  +---------------------------+
                  |        FlexATX PSU        |
                  |                           |
 Standby 5 V -----+--------------------+      |
                  |                    |      |
                  |                +---v---+  |
                  |                | XIAO  |  |
                  |                |ESP32-C3| |
                  |                +---+---+  |
                  |                    |      |
                  | GPIO5              |      |
                  |   |                |      |
                  |   v                |      |
                  | [PS_ON transistor]-+-----> PSU PS_ON
                  |                           |
                  +---------------------------+

                           XIAO ESP32-C3
                      +----------------------+
                      |                      |
 BC-250 sense ------->| D1 / GPIO3           |
                      |                      |
 Case button -------->| D2 / GPIO4           |
                      |                      |
                      | D0 / GPIO2 ----------+---->[Power-button transistor]
                      |                      |                |
                      +----------------------+                v
                                                        BC-250 power button
```

The ESP remains powered even when the BC-250 and PSU main rails are off.

---

## Power connections

### XIAO standby power

The XIAO must remain powered while the PC is shut down so it can continue listening for Bluetooth wake advertisements.

Connect:

```text
PSU standby 5 V  ->  XIAO 5V
PSU ground       ->  XIAO GND
```

Use a standby source that is present whenever the PSU is connected to AC power.

### Grounding

The ESP, PSU-control interface, and BC-250 control interface must share an appropriate common reference.

```text
XIAO GND
   |
   +---- PSU control-circuit ground
   |
   +---- BC-250 control-circuit ground
```

Do not assume two signals share a safe reference without verifying the hardware.

---

## Tested PSU connector pinout

The tested PSU is an **FSP500-30AS** with its non-standard 10-pin motherboard connector.

Viewed with the **connector latch on top**:

```text
TOP ROW
Pin 1   Pin 2   Pin 3   Pin 4   Pin 5
                  |       |
                  |       +---- GND
                  +------------ PS_ON

BOTTOM ROW
Pin 1   Pin 2   Pin 3   Pin 4   Pin 5
                  |
                  +------------ +5 V standby / XIAO supply
```

The connections used by this project are therefore:

| Connector position | Function |
|---|---|
| Top row, pin 3 | PS_ON |
| Top row, pin 4 | GND |
| Bottom row, pin 3 | +5 V standby |

> Verify connector orientation before probing or wiring. The pin numbering above assumes the latch is on top exactly as shown.

The XIAO standby-power connection is:

```text
Bottom row pin 3 (+5 V standby) -> XIAO 5V
Top row pin 4 (GND)             -> XIAO GND
Top row pin 3 (PS_ON)           -> collector of GPIO5 2N2222A stage
```

---

## PSU PS_ON control

The ESP does **not** directly drive the PSU PS_ON signal.

The tested design uses a **2N2222A NPN transistor** stage controlled by:

```text
XIAO D3 / GPIO5
```

The transistor wiring used in the tested build is:

```text
LEFT   = emitter   -> GND
MIDDLE = base      -> 1 kΩ resistor -> GPIO pin
RIGHT  = collector -> controlled signal

10 kΩ resistor from BASE -> GND
```

> **Transistor orientation note:** The left / middle / right lead order above describes the **specific 2N2222A parts used in the tested build** as physically oriented during assembly. 2N2222A pinouts can vary by package and manufacturer. Verify the datasheet for your exact transistor before wiring it.

For the PSU-control transistor:

```text
Emitter   -> GND
Base      -> 1 kΩ -> XIAO D3 / GPIO5
Collector -> PSU PS_ON
10 kΩ     -> base to GND
```

Logical behavior:

```text
GPIO5 LOW  -> transistor off -> PSU PS_ON released
GPIO5 HIGH -> transistor on  -> PSU PS_ON pulled toward GND
```

### Tested PSU control circuit

```text
XIAO GPIO5
    |
   1 kΩ
    |
    +------ Base
    |        |
   10 kΩ     | NPN transistor
    |        |
   GND     Emitter -------- GND
             |
          Collector ------- PSU PS_ON
```

**Do not connect GPIO5 directly to the PSU PS_ON pin.**

---

## BC-250 power-button control

The ESP emulates a short press of the BC-250 motherboard power button.

Firmware output:

```text
XIAO D0 / GPIO2
```

The tested implementation uses the same **2N2222A NPN low-side transistor** arrangement as the PSU control circuit:

```text
Emitter   -> GND
Base      -> 1 kΩ -> XIAO D0 / GPIO2
Collector -> BC-250 power-button signal
10 kΩ     -> base to GND
```

### Tested BC-250 power-button circuit

```text
XIAO GPIO2
    |
   1 kΩ
    |
    +------ Base
    |        |
   10 kΩ     | NPN transistor
    |        |
   GND     Emitter -------- GND
             |
          Collector ------- BC-250 power signal
```

The 10 kΩ base-to-ground resistor keeps the transistor off if the GPIO is floating during startup.

The firmware normally pulses this output for:

```text
250 ms
```

as configured by:

```python
BC250_PRESS_MS = 250
```

This is used for graceful shutdown requests while the BC-250 is running.

---

## BC-250 running-state sense

The ESP needs to know whether the BC-250 is actually running.

Input:

```text
XIAO D1 / GPIO3
```

The tested BC-250 sense point is:

```text
TPMS1 pin 9
```

The firmware expects:

```text
GPIO3 LOW  -> BC-250 off
GPIO3 HIGH -> BC-250 running
```

This signal is used to:

- detect successful startup
- determine when Wi-Fi / the web UI should be active
- detect graceful software shutdown
- know when it is safe to release PSU main power

### Electrical requirement

The voltage presented to GPIO3 must remain within ESP32-C3 input limits.

If the BC-250 sense signal is not already 3.3 V-compatible, use an appropriate level-shifting / transistor / divider interface.

Do **not** feed a 5 V logic signal directly into the ESP32-C3 input.

---

## Physical case button

Input:

```text
XIAO D2 / GPIO4
```

The firmware configures this pin with the ESP's internal pull-up:

```python
Pin(PIN_CASE_BUTTON, Pin.IN, Pin.PULL_UP)
```

Expected wiring:

```text
GPIO4 ---- physical momentary button ---- GND
```

Behavior:

```text
button released -> HIGH
button pressed  -> LOW
```

### Short press

When the BC-250 is off:

- asserts PSU power
- begins startup

When the BC-250 is running:

- pulses the BC-250 power-button interface
- requests graceful shutdown

### Long press

Holding the button for approximately:

```text
4 seconds
```

forces PSU main power off.

Configured by:

```python
FORCE_OFF_HOLD_MS = 4000
```

---

## Complete logical connection table

| XIAO | Connects to | Interface |
|---|---|---|
| 5V | PSU standby 5 V | Direct power input |
| GND | System logic ground | Common reference |
| D0 / GPIO2 | BC-250 power-button control | Through transistor interface |
| D1 / GPIO3 | BC-250 running-state signal | Direct only if verified 3.3 V-safe; otherwise level/interface circuit |
| D2 / GPIO4 | Physical case button | Button to GND |
| D3 / GPIO5 | PSU PS_ON control | Through transistor interface |

---

## Startup sequence

### Physical-button startup

```text
1. XIAO is powered from standby 5 V
2. User presses case button
3. GPIO4 goes LOW
4. Firmware asserts GPIO5
5. PSU PS_ON interface enables PSU main rails
6. BC-250 begins startup
7. BC-250 running-sense GPIO3 goes HIGH
8. Firmware marks startup successful
9. Wi-Fi starts
10. Web UI becomes available
```

### Bluetooth-controller startup

```text
1. XIAO is powered from standby 5 V
2. BLE wake scan is active
3. Configured controller begins advertising
4. ESP sees enough matching advertisements above RSSI threshold
5. Firmware asserts GPIO5
6. PSU main rails turn on
7. BC-250 starts
8. Running-sense GPIO3 goes HIGH
9. Wake scan stops
10. Wi-Fi / web UI starts
```

---

## Shutdown sequence

### Graceful physical-button shutdown

```text
1. User briefly presses case button
2. GPIO4 goes LOW
3. Firmware pulses GPIO2
4. BC-250 receives normal power-button request
5. OS shuts down
6. GPIO3 eventually goes LOW
7. Firmware releases GPIO5
8. PSU main rails turn off
9. ESP remains powered from standby 5 V
10. BLE wake scanning resumes
```

### Software shutdown

If the BC-250 is shut down from Bazzite / the OS:

```text
1. OS shuts down normally
2. Running-sense GPIO3 drops LOW
3. Firmware detects the transition
4. Firmware releases PSU PS_ON control
5. PSU main rails turn off
6. ESP remains alive on standby power
7. BLE wake scanning resumes
```

### Forced shutdown

If the physical button is held for the configured force-off interval:

```text
1. Firmware stops active scans / web handling
2. BC-250 power-button output is released
3. PSU PS_ON control is released
4. Main PSU rails shut off
5. ESP stays powered from standby
```

---

## Recommended build order

Before connecting the BC-250 itself, bring the system up in stages.

### Stage 1 — XIAO only

Verify:

- MicroPython boots
- `main.py` imports `app.mpy`
- `config.py` loads
- serial output is available
- GPIO outputs remain in safe default states

### Stage 2 — physical button

Connect only:

```text
GPIO4 -> button -> GND
```

Verify button presses are detected correctly.

### Stage 3 — PSU control interface

Connect the transistor interface between GPIO5 and PSU PS_ON.

Verify:

- short press turns PSU main rails on
- ESP stays alive when main rails are off
- PS_ON releases correctly

Do this before connecting the BC-250 control lines.

### Stage 4 — BC-250 running sense

Connect the verified 3.3 V-safe sense interface to GPIO3.

Confirm:

```text
BC-250 off     -> GPIO3 LOW
BC-250 running -> GPIO3 HIGH
```

### Stage 5 — BC-250 power-button interface

Connect GPIO2 through the transistor interface to the BC-250 power-button signal.

Confirm a firmware-generated pulse behaves like a physical motherboard power-button press.

### Stage 6 — Bluetooth wake

Only after normal physical-button startup and shutdown work correctly should Bluetooth wake be enabled and tested.

---

## Before applying power

Check all of the following:

- [ ] PSU standby source is actually 5 V
- [ ] XIAO ground and control-interface grounds are correct
- [ ] GPIO3 sense voltage never exceeds ESP32-C3 limits
- [ ] GPIO2 does not directly drive the BC-250 power-button circuit
- [ ] GPIO5 does not directly drive PSU PS_ON
- [ ] transistor pinouts are correct
- [ ] transistor polarity / orientation is correct
- [ ] PSU pinout has been verified for the exact PSU
- [ ] BC-250 control points have been verified with a meter
- [ ] no control wire can short to adjacent PSU / motherboard pins
- [ ] XIAO remains powered when main PSU output is off

---

## Troubleshooting

### ESP turns off when the BC-250 shuts down

The XIAO is probably powered from a main PSU rail instead of standby power.

The ESP needs an always-on standby source.

---

### PSU never turns on

Check:

- GPIO5 configuration
- transistor interface
- PSU PS_ON pin identification
- common ground
- whether PS_ON is being pulled to the required active state

Test the PSU control circuit independently before involving the BC-250.

---

### PSU turns on immediately at ESP boot

Disconnect the BC-250 before continuing.

Check:

- transistor polarity
- GPIO default state
- whether the transistor interface inverts the expected logic
- whether PS_ON is floating

The firmware initializes the PS_ON GPIO to its inactive value, but the external circuit must also have a safe power-up state.

---

### BC-250 starts but firmware never reports it as running

Check the running-sense signal on GPIO3.

Expected:

```text
off     = LOW
running = HIGH
```

Verify voltage with a meter and confirm it is safe for 3.3 V GPIO.

---

### Short case-button press forces power off instead of graceful shutdown

Verify:

- GPIO2 transistor interface
- BC-250 power-button connection
- `BC250_PRESS_MS`
- that the OS is configured to respond normally to a power-button event

---

### Controller wake works but system immediately powers back off

The running-sense signal may not be reaching GPIO3 before:

```python
STARTUP_GRACE_MS
```

expires.

Verify:

- BC-250 sense signal
- startup timing
- PSU stability

---

## Known tested implementation

The current project was developed with:

- Seeed Studio XIAO ESP32-C3
- XIAO powered from PSU standby 5 V
- transistor-controlled PSU PS_ON
- transistor-emulated BC-250 power button
- BC-250 running-state sense input
- physical momentary case button
- MicroPython 1.28.0
- precompiled `app.mpy`

The firmware defaults assume the logical signal behavior described in this document.

---

## Still to document

The electrical interface and PSU connector details used by the tested build are now documented.

The remaining hardware detail worth adding before calling the v1.0 wiring documentation complete is:

- **exact BC-250 power-button signal location**

The running-sense point is now documented as:

```text
TPMS1 pin 9
```

A clearly labeled close-up photo of the BC-250 board power-button connection would be more useful than a photo of the complete wiring harness. The full assembly does not need to look pretty to be valid documentation; the important part is making the board-side connection point unambiguous.

The tested transistor circuit is:

```text
2N2222A

GPIO -> 1 kΩ -> base
10 kΩ from base -> GND
emitter -> GND
collector -> controlled signal
```

The tested FSP500-30AS connector points are:

```text
Latch on top

Top row pin 3    -> PS_ON
Top row pin 4    -> GND
Bottom row pin 3 -> +5 V standby
```

---

## Safety

This project interfaces with PSU and motherboard power-control circuitry.

Do not work on the circuit while mains-powered equipment is open or exposed.

The low-voltage logic side may remain energized from standby power even when the BC-250 appears to be off.

Incorrect wiring can damage:

- the XIAO ESP32-C3
- the BC-250
- the PSU
- attached hardware

Verify every connection before applying power.
