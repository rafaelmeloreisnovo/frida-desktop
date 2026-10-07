# μWRITE — Frida L0 ARMv7/AArch64 cross-arch PASS — 2026-10-07

```text
μID|frida-l0-crossarch-pass-v1
timestamp|2026-10-07T17:53:05-03:00
source/ref|rafaelmeloreisnovo/frida-desktop@2102f01fd21cabafe22de62dd382401fa26f660b
merge/ref|main@786f22f5e7a520222f5aac044fa664efb91290cd
parent|FRIDA_AUTHORIAL_FREESTANDING_L0_PASS_V1_20261007
kind|CROSSARCH_BUILD+STRUCTURAL_EVIDENCE+DEVICE_HANDOFF
Δsummary|same authorial L0 cross-linked ARMv7/AArch64 with no INTERP/NEEDED/undefined; exact-byte device probes published; physical execution still open
routes|L=L0→crossarch→device;O=L0_CORE≠DEVICE_ADAPTER;T=source→object→ELF→hash→artifact→physical;P=SHA/run/artifact;C=Frida-L0;R=core→adapter→device-receipt;I=PR79;E=OMEGA;A=physical-next
evidence|OMEGA#37684304254=PASS; RFL#37684303537=PASS; APK_ELF_DEX#37684303276=PASS; WORKFLOW#37684303182=PASS; PROVENANCE#37684303144=PASS
armv7.core.sha256|9802c0fb914ccc4c96c4babc3a2f297bcabb15b7abee614f6066d6b147123c84
armv7.probe.sha256|580a489b9d5c93c871a4b42a662e3ee8eedb1ba07ed695365d61142c3cf9911d
aarch64.core.sha256|38ddeef3f0cdf9e31680aa83f747c78b1f955db8182b900d907647b43b0a938b
aarch64.probe.sha256|2b2e0cb1d079bde70b64d643e1b053d01bc9885a0ca114faecb0c76daebba8cf
artifact|id=11509863828; name=frida-l0-crossarch-37684304254; archive_sha256=c20bfcfc3d227bab04c2919bce6efba0385259a549da85e91e4c97706a321ced
physical.armv7|TOKEN_VAZIO
physical.aarch64|TOKEN_VAZIO
whole_Frida_freestanding|TOKEN_VAZIO
provider.generic_CI|FAIL_EXTERNAL_AWS_CREDENTIAL_SETUP; source_falsifier=false
timing_observation|runtime-learning first attempt watchdog timeout; unchanged job rerun PASS; retained as historical flake evidence
next|run exact probe bytes on authorized physical ARMv7 and AArch64 devices with tools/frida-l0-on-device-receipt.sh; capture receipt without rebuilding
claim_allowed.crossarch_structure|true
claim_allowed.physical|false
```

This receipt promotes only the cross-architecture structural scope. It does
not promote physical execution or inherited Frida.
