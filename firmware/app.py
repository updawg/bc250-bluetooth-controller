from machine import Pin, PWM
from time import sleep_ms, ticks_ms, ticks_diff
import bluetooth
import network
import socket
import json
import os
from secrets import WIFI_SSID, WIFI_PASSWORD
from config import (
    PIN_BC250_BUTTON,
    PIN_BC250_SENSE,
    PIN_CASE_BUTTON,
    PIN_PS_ON,
    PIN_LED,
    DEBOUNCE_MS,
    BC250_PRESS_MS,
    FORCE_OFF_HOLD_MS,
    FORCE_OFF_PRESS_MS,
    STARTUP_GRACE_MS,
    WAKE_RSSI_MIN,
    WAKE_HITS_REQUIRED,
    WAKE_HIT_WINDOW_MS,
    WAKE_SCAN_MS,
    WEB_SCAN_MS,
    CONTROLLERS_FILE,
    MAX_CONTROLLERS,
    MAX_WEB_PAYLOADS_PER_DEVICE,
    WIFI_CONNECT_TIMEOUT_MS,
    DEFAULT_CONTROLLERS,
    HOSTNAME,
    WEB_UI_DEBUG
)




# ============================================================
# HARDWARE INITIALIZATION
# ============================================================

bc250_button = Pin(
    PIN_BC250_BUTTON,
    Pin.OUT,
    value=0
)

bc250_sense = Pin(
    PIN_BC250_SENSE,
    Pin.IN
)

case_button = Pin(
    PIN_CASE_BUTTON,
    Pin.IN,
    Pin.PULL_UP
)

ps_on = Pin(
    PIN_PS_ON,
    Pin.OUT,
    value=0
)

# Ring LED (J6) and onboard status LED through a low-side MOSFET, active high.
# Hardware PWM, so animating it costs the main loop nothing.
led = PWM(
    Pin(PIN_LED, Pin.OUT, value=0),
    freq=1000,
    duty_u16=0
)


def update_led(system_on):
    """Solid: BC-250 running. 4 Hz blink: starting or shutting down.
    Slow breathe: listening for a wake controller. Dim: idle."""
    if system_on:
        led.duty_u16(65535)
    elif startup_started is not None or shutdown_requested:
        led.duty_u16(65535 if (ticks_ms() // 125) & 1 else 0)
    elif ble_scanning and scan_mode == "wake":
        t = ticks_ms() % 3000
        tri = t if t < 1500 else 3000 - t
        led.duty_u16(min(65535, (tri * tri) // 34))
    else:
        led.duty_u16(1500)


controllers = []
wake_controller_macs = set()


# ============================================================
# POWER STATE
# ============================================================

last_button = 1
press_started = None

shutdown_requested = False
startup_started = None


# ============================================================
# BLE STATE
# ============================================================

ble = bluetooth.BLE()
ble.active(True)

ble_scanning = False
scan_mode = None              # None, "wake", or "web"

ble_wake_requested = False

wake_hits = 0
first_wake_hit = None
wake_candidate = None

web_scan_results = {}
web_scan_done = True


# ============================================================
# WIFI / HTTP STATE
# ============================================================
network.hostname(HOSTNAME)
wlan = network.WLAN(network.STA_IF)
wifi_connect_started = None

server_socket = None


# ============================================================
# MAC HELPERS
# ============================================================

def normalize_mac(mac):
    mac = mac.strip().upper()
    parts = mac.split(":")

    if len(parts) != 6:
        raise ValueError("Invalid MAC")

    values = []

    for part in parts:
        if len(part) != 2:
            raise ValueError("Invalid MAC")

        value = int(part, 16)

        if value < 0 or value > 255:
            raise ValueError("Invalid MAC")

        values.append(value)

    return ":".join(
        "{:02X}".format(value)
        for value in values
    )


def mac_string_to_bytes(mac):
    mac = normalize_mac(mac)

    return bytes(
        int(part, 16)
        for part in mac.split(":")
    )


def format_mac(addr):
    return ":".join(
        "{:02X}".format(b)
        for b in bytes(addr)
    )

def payload_to_hex(payload):
    return "".join(
        "{:02X}".format(b)
        for b in bytes(payload)
    )


# ============================================================
# CONTROLLER DATABASE
# ============================================================

def rebuild_wake_controller_set():
    global wake_controller_macs

    wake_controller_macs = set()

    for controller in controllers:
        try:
            wake_controller_macs.add(
                mac_string_to_bytes(
                    controller["mac"]
                )
            )
        except Exception as e:
            print(
                "Invalid saved controller:",
                controller,
                e
            )


def save_controllers():
    temp_file = CONTROLLERS_FILE + ".tmp"

    data = {
        "controllers": controllers
    }

    try:
        with open(temp_file, "w") as f:
            json.dump(data, f)

        try:
            os.remove(CONTROLLERS_FILE)
        except OSError:
            pass

        os.rename(
            temp_file,
            CONTROLLERS_FILE
        )

        rebuild_wake_controller_set()

        print(
            "Saved",
            len(controllers),
            "controller(s)"
        )

        return True

    except Exception as e:
        print(
            "Failed saving controllers:",
            e
        )

        return False


def load_controllers():
    global controllers

    try:
        with open(CONTROLLERS_FILE, "r") as f:
            data = json.load(f)

        loaded = data.get(
            "controllers",
            []
        )

        if not isinstance(loaded, list):
            raise ValueError(
                "controllers is not a list"
            )

        clean = []

        for entry in loaded:

            if not isinstance(entry, dict):
                continue

            name = str(
                entry.get("name", "")
            ).strip()

            mac = str(
                entry.get("mac", "")
            ).strip()

            if not name or not mac:
                continue

            try:
                mac = normalize_mac(mac)
            except Exception:
                continue

            clean.append({
                "name": name,
                "mac": mac
            })

        controllers = clean

        print(
            "Loaded",
            len(controllers),
            "controller(s)"
        )

    except OSError:

        print(
            "controllers.json missing; "
            "creating default"
        )

        controllers = [
            dict(x)
            for x in DEFAULT_CONTROLLERS
        ]

        save_controllers()

    except Exception as e:

        print(
            "Controller database error:",
            e
        )

        controllers = [
            dict(x)
            for x in DEFAULT_CONTROLLERS
        ]

    rebuild_wake_controller_set()


def controller_name_for_mac(addr_bytes):
    for controller in controllers:

        try:
            if (
                mac_string_to_bytes(
                    controller["mac"]
                )
                == addr_bytes
            ):
                return controller["name"]

        except Exception:
            pass

    return "Unknown"


def add_controller(name, mac):
    name = str(name).strip()

    if not name:
        return False, "Controller name is required"

    try:
        mac = normalize_mac(mac)
    except Exception:
        return False, "Invalid MAC address"

    if len(controllers) >= MAX_CONTROLLERS:
        return False, "Maximum of {} controllers reached".format(MAX_CONTROLLERS)

    for controller in controllers:
        if controller["mac"] == mac:
            return False, "That MAC is already saved"

    controllers.append({
        "name": name,
        "mac": mac
    })

    if not save_controllers():
        controllers.pop()
        return False, "Could not save controller"

    return True, "Controller added"


def remove_controller(mac):
    try:
        mac = normalize_mac(mac)
    except Exception:
        return False, "Invalid MAC address"

    for i, controller in enumerate(controllers):

        if controller["mac"] == mac:

            old = controllers.pop(i)

            if not save_controllers():
                controllers.insert(i, old)
                return False, "Could not save controller"

            return True, "Controller removed"

    return False, "Controller not found"


def update_controller(old_mac, name, new_mac):
    try:
        old_mac = normalize_mac(old_mac)
        new_mac = normalize_mac(new_mac)
    except Exception:
        return False, "Invalid MAC address"

    name = str(name).strip()

    if not name:
        return False, "Controller name is required"

    target = None

    for controller in controllers:
        if controller["mac"] == old_mac:
            target = controller
            break

    if target is None:
        return False, "Controller not found"

    for controller in controllers:
        if (
            controller is not target
            and controller["mac"] == new_mac
        ):
            return False, "New MAC is already saved"

    old_name = target["name"]
    previous_mac = target["mac"]

    target["name"] = name
    target["mac"] = new_mac

    if not save_controllers():

        target["name"] = old_name
        target["mac"] = previous_mac

        return False, "Could not save changes"

    return True, "Controller updated"


# ============================================================
# BLE ADVERTISEMENT NAME
# ============================================================

def advertisement_name(payload):
    payload = bytes(payload)

    i = 0

    while i < len(payload):

        length = payload[i]

        if length == 0:
            break

        end = i + length + 1

        if end > len(payload):
            break

        field_type = payload[i + 1]

        # Shortened or complete local name
        if field_type in (0x08, 0x09):

            try:
                return payload[
                    i + 2:end
                ].decode("utf-8")

            except Exception:
                return ""

        i = end

    return ""


# ============================================================
# BLE SCANNING
# ============================================================

def reset_wake_hits():
    global wake_hits
    global first_wake_hit
    global wake_candidate

    wake_hits = 0
    first_wake_hit = None
    wake_candidate = None


def stop_ble_scan():
    global ble_scanning
    global scan_mode

    if ble_scanning:

        try:
            ble.gap_scan(None)
        except Exception:
            pass

    ble_scanning = False
    scan_mode = None

    reset_wake_hits()


def start_wake_scan():
    global ble_scanning
    global scan_mode

    if ble_scanning:
        return

    scan_mode = "wake"

    ble.gap_scan(
        WAKE_SCAN_MS,
        30000,
        30000,
        False
    )

    ble_scanning = True


def start_web_scan():
    global ble_scanning
    global scan_mode
    global web_scan_results
    global web_scan_done

    if ble_scanning:
        return False

    web_scan_results = {}
    web_scan_done = False

    scan_mode = "web"

    print("Starting web BLE scan")

    ble.gap_scan(
        WEB_SCAN_MS,
        30000,
        30000,
        True
    )

    ble_scanning = True

    return True


def bt_irq(event, data):
    global ble_scanning
    global scan_mode

    global ble_wake_requested
    global wake_hits
    global first_wake_hit
    global wake_candidate

    global web_scan_done


    # --------------------------------------------------------
    # Scan result
    # --------------------------------------------------------

    if event == 5:

        addr_type, addr, adv_type, rssi, payload = data

        addr_bytes = bytes(addr)
        mac = format_mac(addr_bytes)


        # ====================================================
        # WAKE MODE
        # ====================================================

        if scan_mode == "wake":

            if addr_bytes not in wake_controller_macs:
                return

            if rssi < WAKE_RSSI_MIN:
                return

            now = ticks_ms()

            # Different saved controller appeared.
            # Start confirmation over for this controller.
            if wake_candidate != addr_bytes:

                wake_candidate = addr_bytes
                first_wake_hit = now
                wake_hits = 1

            elif first_wake_hit is None:

                first_wake_hit = now
                wake_hits = 1

            elif ticks_diff(
                now,
                first_wake_hit
            ) <= WAKE_HIT_WINDOW_MS:

                wake_hits += 1

            else:

                first_wake_hit = now
                wake_hits = 1

            print(
                "Wake controller:",
                controller_name_for_mac(
                    addr_bytes
                ),
                mac,
                "RSSI:",
                rssi,
                "Hit:",
                wake_hits
            )

            if wake_hits >= WAKE_HITS_REQUIRED:

                print(
                    "Bluetooth wake confirmed"
                )

                ble_wake_requested = True

                reset_wake_hits()


        # ====================================================
        # WEB SCAN MODE
        # ====================================================

        elif scan_mode == "web":

            payload_hex = payload_to_hex(
                payload
            )

            name = advertisement_name(
                payload
            )

            existing = web_scan_results.get(
                mac
            )

            if existing is None:

                web_scan_results[mac] = {
                    "mac": mac,
                    "name": name,
                    "rssi": rssi,

                    # Payload from strongest observation.
                    "payload": payload_hex,

                    # Up to N distinct packets observed
                    # during this scan.
                    "payloads": [
                        payload_hex
                    ]
                }

            else:

                # ------------------------------------------------
                # KEEP STRONGEST RSSI + ITS PAYLOAD
                # ------------------------------------------------

                if rssi > existing["rssi"]:

                    existing["rssi"] = rssi
                    existing["payload"] = payload_hex

                    if name:
                        existing["name"] = name


                # ------------------------------------------------
                # RETAIN UNIQUE ADVERTISEMENT VARIANTS
                # ------------------------------------------------

                payloads = existing[
                    "payloads"
                ]

                if (
                    payload_hex not in payloads
                    and len(payloads)
                    < MAX_WEB_PAYLOADS_PER_DEVICE
                ):

                    payloads.append(
                        payload_hex
                    )


                # ------------------------------------------------
                # DON'T LOSE A NAME JUST BECAUSE THE
                # STRONGEST PACKET DIDN'T CONTAIN IT
                # ------------------------------------------------

                if (
                    not existing["name"]
                    and name
                ):

                    existing["name"] = name


    # --------------------------------------------------------
    # Scan completed
    # --------------------------------------------------------

    elif event == 6:

        previous_mode = scan_mode

        ble_scanning = False
        scan_mode = None

        if previous_mode == "web":

            web_scan_done = True

            print(
                "Web BLE scan complete:",
                len(web_scan_results),
                "device(s)"
            )


ble.irq(bt_irq)


# ============================================================
# POWER
# ============================================================

def request_startup(source):
    global startup_started

    if ps_on.value():
        return

    print(
        "Powering PSU ON - source:",
        source
    )

    ps_on.value(1)

    startup_started = ticks_ms()


# ============================================================
# WIFI
# ============================================================

def start_wifi():
    global wifi_connect_started

    if (
        wlan.active()
        and (
            wlan.isconnected()
            or wifi_connect_started is not None
        )
    ):
        return

    print("Starting Wi-Fi")

    wlan.active(True)

    try:
        wlan.connect(
            WIFI_SSID,
            WIFI_PASSWORD
        )

    except Exception as e:
        print(
            "Wi-Fi connection error:",
            e
        )

    wifi_connect_started = ticks_ms()


def stop_wifi():
    global wifi_connect_started

    stop_web_server()

    if wlan.active():

        print("Stopping Wi-Fi")

        try:
            wlan.disconnect()
        except Exception:
            pass

        wlan.active(False)

    wifi_connect_started = None


def update_wifi():
    global wifi_connect_started

    if not wlan.active():
        return

    if wlan.isconnected():

        if wifi_connect_started is not None:

            wifi_connect_started = None

            ip = wlan.ifconfig()[0]

            print("Wi-Fi connected")
            print(
                "Web UI: http://{}".format(ip)
            )

            start_web_server()

        return


    if wifi_connect_started is not None:

        if ticks_diff(
            ticks_ms(),
            wifi_connect_started
        ) > WIFI_CONNECT_TIMEOUT_MS:

            print(
                "Wi-Fi connection timed out"
            )

            try:
                wlan.disconnect()
            except Exception:
                pass

            wlan.active(False)
            wifi_connect_started = None


# ============================================================
# HTTP HELPERS
# ============================================================

def send_all(client, data):

    if isinstance(data, str):
        data = data.encode()

    total = 0

    while total < len(data):

        sent = client.send(
            data[total:total + 512]
        )

        if sent is None or sent <= 0:
            raise OSError("Socket send failed")

        total += sent


def send_response(
    client,
    status,
    content_type,
    body
):

    if isinstance(body, str):
        body = body.encode()

    header = (
        "HTTP/1.1 {}\r\n"
        "Content-Type: {}\r\n"
        "Content-Length: {}\r\n"
        "Connection: close\r\n"
        "Cache-Control: no-store\r\n"
        "\r\n"
    ).format(
        status,
        content_type,
        len(body)
    )

    send_all(
        client,
        header
    )

    send_all(
        client,
        body
    )


def send_json(
    client,
    data,
    status="200 OK"
):

    send_response(
        client,
        status,
        "application/json",
        json.dumps(data)
    )


def serve_file(client, filename, content_type):

    try:
        f = open(filename, "rb")

    except OSError as e:
        print("Could not open static file:", filename, e)

        send_response(
            client,
            "404 Not Found",
            "text/plain",
            "Not found"
        )

        return

    try:
        size = os.stat(filename)[6]

        header = (
            "HTTP/1.1 200 OK\r\n"
            "Content-Type: {}\r\n"
            "Content-Length: {}\r\n"
            "Connection: close\r\n"
            "Cache-Control: no-store\r\n"
            "\r\n"
        ).format(content_type, size)

        send_all(client, header)

        while True:
            chunk = f.read(512)

            if not chunk:
                break

            send_all(client, chunk)

    except OSError as e:
        print("Static file transfer error:", filename, e)

    finally:
        f.close()
        
# ============================================================
# HTTP REQUEST PARSING
# ============================================================

def receive_request(client):

    data = b""

    client.settimeout(5)

    # Read through headers
    while b"\r\n\r\n" not in data:

        chunk = client.recv(1024)

        if not chunk:
            break

        data += chunk

        if len(data) > 8192:
            raise ValueError(
                "Request too large"
            )


    if b"\r\n\r\n" not in data:
        raise ValueError(
            "Incomplete HTTP request"
        )


    header_data, body = data.split(
        b"\r\n\r\n",
        1
    )

    header_text = header_data.decode()

    lines = header_text.split(
        "\r\n"
    )

    request_line = lines[0].split()

    if len(request_line) < 2:
        raise ValueError(
            "Invalid request line"
        )

    method = request_line[0]
    path = request_line[1]

    content_length = 0

    for line in lines[1:]:

        if ":" not in line:
            continue

        key, value = line.split(
            ":",
            1
        )

        if key.strip().lower() == "content-length":

            content_length = int(
                value.strip()
            )


    while len(body) < content_length:

        chunk = client.recv(
            min(
                1024,
                content_length - len(body)
            )
        )

        if not chunk:
            break

        body += chunk


    return (
        method,
        path,
        body[:content_length]
    )


# ============================================================
# API
# ============================================================

def status_data():

    return {
        "system": (
            "RUNNING"
            if bc250_sense.value()
            else "OFF"
        ),

        "psu": (
            "ON"
            if ps_on.value()
            else "OFF"
        ),

        "ip": (
            wlan.ifconfig()[0]
            if wlan.isconnected()
            else None
        ),

        "controllers": len(
            controllers
        ),

        "web_ui_debug": WEB_UI_DEBUG
    }


def scan_results_data():

    scanning_now = (
        ble_scanning
        and scan_mode == "web"
    )

    # While a web scan is running, keep polling responses tiny.
    # The browser does not use device payloads until the scan ends.
    if scanning_now:
        return {
            "scanning": True,
            "done": False,
            "devices": []
        }

    results = list(
        web_scan_results.values()
    )

    # Simple RSSI sort, strongest first.
    results.sort(
        key=lambda item: item["rssi"],
        reverse=True
    )

    return {
        "scanning": False,
        "done": web_scan_done,
        "devices": results
    }


def handle_api(
    client,
    method,
    path,
    body
):

    # --------------------------------------------------------
    # STATUS
    # --------------------------------------------------------

    if (
        method == "GET"
        and path == "/api/status"
    ):

        send_json(
            client,
            status_data()
        )

        return


    # --------------------------------------------------------
    # CONTROLLERS
    # --------------------------------------------------------

    if (
        method == "GET"
        and path == "/api/controllers"
    ):

        send_json(
            client,
            {
                "controllers": controllers,
                "max": MAX_CONTROLLERS
            }
        )

        return


    # --------------------------------------------------------
    # START BLE SCAN
    # --------------------------------------------------------

    if (
        method == "POST"
        and path == "/api/scan"
    ):

        if not bc250_sense.value():

            send_json(
                client,
                {
                    "ok": False,
                    "message": (
                        "Scanning from the web UI "
                        "requires the BC-250 to be running"
                    )
                },
                "409 Conflict"
            )

            return


        if ble_scanning:

            send_json(
                client,
                {
                    "ok": False,
                    "message": (
                        "Bluetooth scan already running"
                    )
                },
                "409 Conflict"
            )

            return


        start_web_scan()

        send_json(
            client,
            {
                "ok": True,
                "message": "BLE scan started"
            }
        )

        return


    # --------------------------------------------------------
    # SCAN RESULTS
    # --------------------------------------------------------

    if (
        method == "GET"
        and path == "/api/scan"
    ):

        send_json(
            client,
            scan_results_data()
        )

        return


    # --------------------------------------------------------
    # JSON BODY
    # --------------------------------------------------------

    payload = {}

    if body:

        try:
            payload = json.loads(
                body.decode()
            )

        except Exception:

            send_json(
                client,
                {
                    "ok": False,
                    "message": "Invalid JSON"
                },
                "400 Bad Request"
            )

            return


    # --------------------------------------------------------
    # ADD CONTROLLER
    # --------------------------------------------------------

    if (
        method == "POST"
        and path == "/api/controllers/add"
    ):

        ok, message = add_controller(
            payload.get("name", ""),
            payload.get("mac", "")
        )

        send_json(
            client,
            {
                "ok": ok,
                "message": message
            },
            (
                "200 OK"
                if ok
                else "400 Bad Request"
            )
        )

        return


    # --------------------------------------------------------
    # UPDATE CONTROLLER
    # --------------------------------------------------------

    if (
        method == "POST"
        and path == "/api/controllers/update"
    ):

        ok, message = update_controller(
            payload.get("old_mac", ""),
            payload.get("name", ""),
            payload.get("mac", "")
        )

        send_json(
            client,
            {
                "ok": ok,
                "message": message
            },
            (
                "200 OK"
                if ok
                else "400 Bad Request"
            )
        )

        return


    # --------------------------------------------------------
    # REMOVE CONTROLLER
    # --------------------------------------------------------

    if (
        method == "POST"
        and path == "/api/controllers/remove"
    ):

        ok, message = remove_controller(
            payload.get("mac", "")
        )

        send_json(
            client,
            {
                "ok": ok,
                "message": message
            },
            (
                "200 OK"
                if ok
                else "400 Bad Request"
            )
        )

        return


    send_json(
        client,
        {
            "ok": False,
            "message": "Unknown API route"
        },
        "404 Not Found"
    )


# ============================================================
# WEB SERVER
# ============================================================

def start_web_server():
    global server_socket

    if server_socket is not None:
        return

    try:

        addr = socket.getaddrinfo(
            "0.0.0.0",
            80
        )[0][-1]

        server_socket = socket.socket()

        server_socket.setsockopt(
            socket.SOL_SOCKET,
            socket.SO_REUSEADDR,
            1
        )

        server_socket.bind(addr)
        server_socket.listen(2)

        server_socket.settimeout(
            0.01
        )

        print(
            "Web server started"
        )

    except Exception as e:

        print(
            "Web server error:",
            e
        )

        server_socket = None


def stop_web_server():
    global server_socket

    if server_socket is not None:

        try:
            server_socket.close()
        except Exception:
            pass

        server_socket = None

        print(
            "Web server stopped"
        )


def service_web_server():

    if server_socket is None:
        return

    try:

        client, address = (
            server_socket.accept()
        )

    except OSError:
        return

    except Exception as e:

        print(
            "HTTP accept error:",
            e
        )

        return


    try:

        method, path, body = (
            receive_request(client)
        )

        # Strip query string if one appears.
        path = path.split(
            "?",
            1
        )[0]


        # ----------------------------------------------------
        # STATIC FILES
        # ----------------------------------------------------

        if (
            method == "GET"
            and path == "/"
        ):

            serve_file(
                client,
                "www/index.html",
                "text/html"
            )


        elif (
            method == "GET"
            and path == "/style.css"
        ):

            serve_file(
                client,
                "www/style.css",
                "text/css"
            )


        elif (
            method == "GET"
            and path == "/app.js"
        ):

            serve_file(
                client,
                "www/app.js",
                "application/javascript"
            )


        # ----------------------------------------------------
        # API
        # ----------------------------------------------------

        elif path.startswith(
            "/api/"
        ):

            handle_api(
                client,
                method,
                path,
                body
            )


        else:

            send_response(
                client,
                "404 Not Found",
                "text/plain",
                "Not found"
            )


    except Exception as e:

        print(
            "HTTP request error:",
            e
        )

        try:
            send_response(
                client,
                "500 Internal Server Error",
                "text/plain",
                "Internal error"
            )
        except Exception:
            pass


    finally:

        try:
            client.close()
        except Exception:
            pass


# ============================================================
# LOAD CONFIG
# ============================================================

load_controllers()


# ============================================================
# STARTUP
# ============================================================

print(
    "BC250 management controller ready"
)

print(
    "Saved wake controllers:"
)

for controller in controllers:

    print(
        " -",
        controller["name"],
        controller["mac"]
    )


# ============================================================
# MAIN LOOP
# ============================================================

while True:

    button_now = (
        case_button.value()
    )

    system_on = (
        bc250_sense.value() == 1
    )


    # ========================================================
    # BC250 OFF
    #
    # Web/Wi-Fi OFF
    # BLE wake ON
    # ========================================================

    if (
        not system_on
        and ps_on.value() == 0
        and startup_started is None
    ):

        if wlan.active():
            stop_wifi()

        # If some other kind of BLE scan was active,
        # kill it before returning to wake scanning.
        if (
            ble_scanning
            and scan_mode != "wake"
        ):
            stop_ble_scan()

        if not ble_scanning:
            start_wake_scan()


    # ========================================================
    # BC250 RUNNING
    #
    # Wake scan OFF
    # Wi-Fi/Web ON
    #
    # Web scan remains allowed when requested.
    # ========================================================

    if system_on:

        if (
            ps_on.value() == 0
            and startup_started is None
        ):
            # The host is up but we are not asserting PS_ON: the XIAO was reset,
            # or the PSU was started with the always-on jumper. On the BC-250
            # Wake board Q2 is holding PS_ON in hardware; take over so the
            # shutdown paths below release it in step.
            ps_on.value(1)

        if (
            ble_scanning
            and scan_mode == "wake"
        ):
            stop_ble_scan()

        if not wlan.active():
            start_wifi()

        update_wifi()
        service_web_server()


    # ========================================================
    # CONTROLLER WAKE
    # ========================================================

    if ble_wake_requested:

        ble_wake_requested = False

        if (
            not system_on
            and ps_on.value() == 0
            and startup_started is None
        ):

            stop_ble_scan()

            request_startup(
                "Bluetooth controller"
            )


    # ========================================================
    # CASE BUTTON PRESS
    # ========================================================

    if (
        last_button == 1
        and button_now == 0
    ):

        press_started = ticks_ms()

        sleep_ms(
            DEBOUNCE_MS
        )


    # ========================================================
    # CASE BUTTON RELEASE
    # ========================================================

    if (
        last_button == 0
        and button_now == 1
        and press_started is not None
    ):

        held_ms = ticks_diff(
            ticks_ms(),
            press_started
        )

        press_started = None


        # ----------------------------------------------------
        # FORCE OFF
        # ----------------------------------------------------

        if held_ms >= FORCE_OFF_HOLD_MS:

            print("FORCE OFF")

            stop_ble_scan()
            stop_wifi()

            if system_on:
                # Q2 holds PS_ON in hardware while HOST_ON is high, so releasing
                # GPIO5 alone would do nothing. Hold the BC-250's own power
                # button instead: its hard-off drops HOST_ON and the hardware
                # hold releases with it.
                print(
                    "Holding BC-250 power button",
                    FORCE_OFF_PRESS_MS,
                    "ms"
                )
                bc250_button.value(1)
                sleep_ms(FORCE_OFF_PRESS_MS)
                bc250_button.value(0)
                sleep_ms(500)

            bc250_button.value(0)
            ps_on.value(0)

            shutdown_requested = False
            startup_started = None

            reset_wake_hits()


        # ----------------------------------------------------
        # NORMAL BUTTON
        # ----------------------------------------------------

        else:

            if (
                not system_on
                and ps_on.value() == 0
            ):

                stop_ble_scan()

                request_startup(
                    "case button"
                )


            elif system_on:

                print(
                    "Requesting graceful shutdown"
                )

                bc250_button.value(1)

                sleep_ms(
                    BC250_PRESS_MS
                )

                bc250_button.value(0)

                shutdown_requested = True


    # ========================================================
    # STARTUP COMPLETE
    # ========================================================

    if (
        startup_started is not None
        and system_on
    ):

        print(
            "BC250 running"
        )

        startup_started = None

        stop_ble_scan()

        start_wifi()


    # ========================================================
    # BUTTON-REQUESTED SHUTDOWN COMPLETE
    # ========================================================

    if (
        shutdown_requested
        and not system_on
    ):

        print(
            "BC250 shutdown detected"
        )

        sleep_ms(500)

        if bc250_sense.value() == 0:

            stop_ble_scan()
            stop_wifi()

            print(
                "Releasing PSU"
            )

            ps_on.value(0)

            shutdown_requested = False

            reset_wake_hits()


    # ========================================================
    # SOFTWARE SHUTDOWN
    # ========================================================

    if (
        ps_on.value() == 1
        and not system_on
        and not shutdown_requested
        and startup_started is None
    ):

        print(
            "BC250 powered down from software"
        )

        sleep_ms(500)

        if bc250_sense.value() == 0:

            stop_ble_scan()
            stop_wifi()

            print(
                "Releasing PSU"
            )

            ps_on.value(0)

            reset_wake_hits()


    # ========================================================
    # STARTUP TIMEOUT
    # ========================================================

    if startup_started is not None:

        if ticks_diff(
            ticks_ms(),
            startup_started
        ) > STARTUP_GRACE_MS:

            if not system_on:

                print(
                    "BC250 did not come up - PSU OFF"
                )

                ps_on.value(0)

            startup_started = None

            reset_wake_hits()


    update_led(system_on)

    last_button = button_now

    sleep_ms(10)


