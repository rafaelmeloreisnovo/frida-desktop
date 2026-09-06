'use strict';

/*
 * Metadata-only Android crash observer.
 *
 * Invariant: crash -> dump recent outbound network-operation metadata.
 * Payload bytes are never read, hashed, copied, decoded, or persisted.
 * Native exceptions are observed and then forwarded by returning false.
 */

const SCHEMA = 2;
const NET_RING_CAPACITY = 64;
const netRing = new Array(NET_RING_CAPACITY);
let netWriteIndex = 0;
let netCount = 0;
let netSequence = 0;
let crashTriggered = false;
let emitDepth = 0;
const endpointByFd = Object.create(null);

function pointerText(value) {
  if (value === null || value === undefined)
    return null;
  try {
    return value.toString();
  } catch (_) {
    return null;
  }
}

function emit(kind, extra) {
  const event = {
    schema: SCHEMA,
    channel: 'rafaelia.android.crash',
    kind: kind,
    pid: Process.id,
    tid: Process.getCurrentThreadId(),
    arch: Process.arch,
    pointer_size: Process.pointerSize,
    page_size: Process.pageSize
  };

  Object.keys(extra || {}).forEach(function (key) {
    event[key] = extra[key];
  });

  emitDepth++;
  try {
    send(event);
  } finally {
    emitDepth--;
  }
}

function fnv1a32Text(text) {
  let hash = 0x811c9dc5;
  for (let i = 0; i !== text.length; i++) {
    hash ^= text.charCodeAt(i) & 0xff;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return ('00000000' + hash.toString(16)).slice(-8);
}

function safeU8(pointer, offset) {
  try {
    return pointer.add(offset).readU8();
  } catch (_) {
    return 0;
  }
}

function endpointMetadata(sockaddr) {
  if (sockaddr === null || sockaddr === undefined || sockaddr.isNull())
    return { family: 0, port: 0, endpoint_tag: 'TOKEN_VAZIO' };

  try {
    const family = sockaddr.readU16();
    const port = (safeU8(sockaddr, 2) << 8) | safeU8(sockaddr, 3);
    let material = String(family) + ':' + String(port) + ':';
    let length = 0;

    if (family === 2) {
      length = 4;
      for (let i = 0; i !== length; i++)
        material += safeU8(sockaddr, 4 + i).toString(16).padStart(2, '0');
    } else if (family === 10) {
      length = 16;
      for (let i = 0; i !== length; i++)
        material += safeU8(sockaddr, 8 + i).toString(16).padStart(2, '0');
    } else {
      material += 'family-only';
    }

    return {
      family: family,
      port: port,
      endpoint_tag: fnv1a32Text(material)
    };
  } catch (_) {
    return { family: 0, port: 0, endpoint_tag: 'TOKEN_VAZIO' };
  }
}

function operationFingerprint(kind, fd, requested, flags, endpointTag, returnAddress) {
  return fnv1a32Text([
    kind,
    fd,
    requested,
    flags,
    endpointTag || 'TOKEN_VAZIO',
    returnAddress || 'TOKEN_VAZIO'
  ].join('|'));
}

function pushNetworkOperation(operation) {
  operation.seq = ++netSequence;
  operation.crash_triggered = crashTriggered;
  netRing[netWriteIndex] = operation;
  netWriteIndex = (netWriteIndex + 1) % NET_RING_CAPACITY;
  if (netCount < NET_RING_CAPACITY)
    netCount++;

  if (crashTriggered && emitDepth === 0)
    emit('POST_CRASH_NET', { operation: operation });
}

function outboundTail() {
  const result = [];
  const start = (netWriteIndex + NET_RING_CAPACITY - netCount) % NET_RING_CAPACITY;
  for (let i = 0; i !== netCount; i++)
    result.push(netRing[(start + i) % NET_RING_CAPACITY]);
  return result;
}

function getGlobalExport(name) {
  try {
    if (typeof Module.getGlobalExportByName === 'function')
      return Module.getGlobalExportByName(name);
  } catch (_) {
  }
  try {
    if (typeof Module.findGlobalExportByName === 'function')
      return Module.findGlobalExportByName(name);
  } catch (_) {
  }
  try {
    return Module.getExportByName(null, name);
  } catch (_) {
    return null;
  }
}

function attachConnect() {
  const target = getGlobalExport('connect');
  if (target === null)
    return false;

  Interceptor.attach(target, {
    onEnter(args) {
      if (emitDepth !== 0) {
        this.skip = true;
        return;
      }
      this.skip = false;
      this.fd = args[0].toInt32();
      this.endpoint = endpointMetadata(args[1]);
      this.returnAddressText = pointerText(this.returnAddress);
    },
    onLeave(retval) {
      if (this.skip)
        return;
      const result = retval.toInt32();
      if (result === 0)
        endpointByFd[String(this.fd)] = this.endpoint;
      pushNetworkOperation({
        op: 'connect',
        fd: this.fd,
        requested_bytes: 0,
        result: result,
        flags: 0,
        family: this.endpoint.family,
        port: this.endpoint.port,
        endpoint_tag: this.endpoint.endpoint_tag,
        op_fingerprint: operationFingerprint(
            'connect', this.fd, 0, 0, this.endpoint.endpoint_tag,
            this.returnAddressText)
      });
    }
  });
  return true;
}

function attachSendLike(name, hasDestination) {
  const target = getGlobalExport(name);
  if (target === null)
    return false;

  Interceptor.attach(target, {
    onEnter(args) {
      if (emitDepth !== 0) {
        this.skip = true;
        return;
      }
      this.skip = false;
      this.fd = args[0].toInt32();
      /* args[1] is the payload pointer. It is intentionally never dereferenced. */
      this.requested = Number(args[2].toUInt32());
      this.flags = args[3].toInt32();
      this.returnAddressText = pointerText(this.returnAddress);

      if (hasDestination)
        this.endpoint = endpointMetadata(args[4]);
      else
        this.endpoint = endpointByFd[String(this.fd)] ||
            { family: 0, port: 0, endpoint_tag: 'TOKEN_VAZIO' };
    },
    onLeave(retval) {
      if (this.skip)
        return;
      const result = retval.toInt32();
      pushNetworkOperation({
        op: name,
        fd: this.fd,
        requested_bytes: this.requested,
        result: result,
        flags: this.flags,
        family: this.endpoint.family,
        port: this.endpoint.port,
        endpoint_tag: this.endpoint.endpoint_tag,
        op_fingerprint: operationFingerprint(
            name, this.fd, this.requested, this.flags,
            this.endpoint.endpoint_tag, this.returnAddressText)
      });
    }
  });
  return true;
}

const networkHooks = {
  connect: attachConnect(),
  send: attachSendLike('send', false),
  sendto: attachSendLike('sendto', true)
};

Process.setExceptionHandler(function (details) {
  const memory = details.memory || null;
  const context = details.context || {};
  crashTriggered = true;

  emit('NATIVE_EXCEPTION', {
    exception_type: details.type,
    address: pointerText(details.address),
    pc: pointerText(context.pc),
    sp: pointerText(context.sp),
    memory_operation: memory === null ? null : memory.operation,
    fault_address: memory === null ? null : pointerText(memory.address),
    network_hooks: networkHooks,
    outbound_tail: outboundTail()
  });

  /* Observation only: never swallow, rewrite registers, or resume a crash. */
  return false;
});

if (Java.available) {
  Java.perform(function () {
    try {
      const ThreadGroup = Java.use('java.lang.ThreadGroup');
      const uncaught = ThreadGroup.uncaughtException.overload(
          'java.lang.Thread', 'java.lang.Throwable');

      uncaught.implementation = function (thread, throwable) {
        try {
          let throwableClass = 'TOKEN_VAZIO';
          let javaThreadId = 0;
          try {
            throwableClass = throwable.getClass().getName().toString();
          } catch (_) {
          }
          try {
            javaThreadId = Number(thread.getId());
          } catch (_) {
          }

          crashTriggered = true;
          emit('JAVA_UNCAUGHT', {
            java_thread_id: javaThreadId,
            throwable_class: throwableClass,
            network_hooks: networkHooks,
            outbound_tail: outboundTail()
          });
        } catch (_) {
          /* Never alter the application's exception path if telemetry fails. */
        }

        return uncaught.call(this, thread, throwable);
      };
    } catch (error) {
      emit('TOKEN_VAZIO', {
        gap: 'JAVA_UNCAUGHT_HOOK_UNAVAILABLE',
        error_class: error === null || error === undefined ?
            'unknown' : error.constructor.name
      });
    }
  });
} else {
  emit('TOKEN_VAZIO', { gap: 'JAVA_RUNTIME_UNAVAILABLE' });
}
