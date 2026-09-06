'use strict';

/*
 * Metadata-only Android crash observer.
 * It never reads payloads, keystrokes, clipboard, URLs, headers, credentials,
 * exception messages, or UI content. Native exceptions are observed and then
 * forwarded to the application's/OS handler by returning false.
 */

const SCHEMA = 1;

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
  send(event);
}

Process.setExceptionHandler(function (details) {
  const memory = details.memory || null;
  const context = details.context || {};

  emit('NATIVE_EXCEPTION', {
    exception_type: details.type,
    address: pointerText(details.address),
    pc: pointerText(context.pc),
    sp: pointerText(context.sp),
    memory_operation: memory === null ? null : memory.operation,
    fault_address: memory === null ? null : pointerText(memory.address)
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

          emit('JAVA_UNCAUGHT', {
            java_thread_id: javaThreadId,
            throwable_class: throwableClass
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
