# Frida L0 — exact-byte physical device handoff

State: `READY_FOR_PHYSICAL_EXECUTION / NOT_YET_EXECUTED`.

Authoritative source head: `2102f01fd21cabafe22de62dd382401fa26f660b`.  
OMEGA run: `37684304254`.  
Artifact: `frida-l0-crossarch-37684304254` / id `11509863828`.

Do not rebuild on the device. Use the exact probe bytes from the artifact.

## ARMv7

Expected probe SHA-256:

`580a489b9d5c93c871a4b42a662e3ee8eedb1ba07ed695365d61142c3cf9911d`

After copying `build/frida-l0-crossarch/armv7/l0-device-probe.elf` and
`tools/frida-l0-on-device-receipt.sh` to the ARMv7 device:

```sh
bash tools/frida-l0-on-device-receipt.sh \
  build/frida-l0-crossarch/armv7/l0-device-probe.elf \
  580a489b9d5c93c871a4b42a662e3ee8eedb1ba07ed695365d61142c3cf9911d \
  2102f01fd21cabafe22de62dd382401fa26f660b \
  armv7 > frida-l0-armv7-physical-receipt.json
```

## AArch64

Expected probe SHA-256:

`2b2e0cb1d079bde70b64d643e1b053d01bc9885a0ca114faecb0c76daebba8cf`

```sh
bash tools/frida-l0-on-device-receipt.sh \
  build/frida-l0-crossarch/aarch64/l0-device-probe.elf \
  2b2e0cb1d079bde70b64d643e1b053d01bc9885a0ca114faecb0c76daebba8cf \
  2102f01fd21cabafe22de62dd382401fa26f660b \
  aarch64 > frida-l0-aarch64-physical-receipt.json
```

A receipt is valid only if the script first matches the artifact SHA-256 and
the probe exits with code 0. That proves only the exact L0+raw-exit adapter on
the identified device. It does not prove the whole Frida runtime freestanding.
