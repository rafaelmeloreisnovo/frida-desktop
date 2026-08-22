#define _POSIX_C_SOURCE 200809L
#include "learning_store.h"

#include <assert.h>
#include <fcntl.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

static void must(int condition, const char *message) {
    if (!condition) {
        fprintf(stderr, "SELFTEST FAIL: %s\n", message);
        exit(1);
    }
}

static void corrupt_last_byte(const char *path) {
    int fd = open(path, O_RDWR);
    must(fd >= 0, "open corrupt target");
    off_t end = lseek(fd, 0, SEEK_END);
    must(end > (off_t)RAFAELIA_RFL_HEADER_BYTES, "store has record payload");
    unsigned char byte = 0;
    must(pread(fd, &byte, 1, end - 1) == 1, "read tail byte");
    byte ^= 0x5au;
    must(pwrite(fd, &byte, 1, end - 1) == 1, "write corrupt tail byte");
    must(fdatasync(fd) == 0, "sync corrupt tail byte");
    must(close(fd) == 0, "close corrupt target");
}

int main(void) {
    char path[] = "/tmp/rafaelia-rfl-selftest-XXXXXX";
    int tmp = mkstemp(path);
    must(tmp >= 0, "mkstemp");
    must(close(tmp) == 0, "close seed file");
    must(unlink(path) == 0, "remove seed file");

    must(sizeof(RafaeliaRflHeaderV1) == 64u, "header ABI 64 B");
    must(sizeof(RafaeliaRflRecordV1) == 64u, "record ABI 64 B");
    must(RAFAELIA_RFL_RECORDS_PER_SLAB == 64u, "64 records per 4 KiB slab");

    must(rafaelia_learning_init(path, NULL) == 0, "init new store");
    must(rafaelia_learning_set_mode(RAFAELIA_LEARNING_LEARN_SHADOW) == 0,
         "enter learn shadow");

    const uint64_t stable_context = UINT64_C(0x1020304050607080);
    for (uint32_t i = 0; i < 1000u; ++i) {
        must(rafaelia_learning_observe(
                 stable_context,
                 7u,
                 3u,
                 1200u + (i & 31u),
                 (i & 1u) ? 16 : -16,
                 UINT64_C(0xaabbccdd00000000) | i) == 0,
             "append stable observation");
    }

    RafaeliaLearningSnapshotV1 first;
    must(rafaelia_learning_snapshot(&first) == 0, "snapshot first run");
    must(first.observations == 1000u, "1000 observations");
    must(first.predictions == 999u, "999 shadow predictions after cold start");
    must(first.correct_predictions == 999u, "stable context predicts correctly");
    must(first.incorrect_predictions == 0u, "zero incorrect stable predictions");
    must(first.eligible_contexts == 0u, "automatic promotion remains disabled");
    must((first.flags & RAFAELIA_LEARNING_SNAPSHOT_PROMOTION_DISABLED) != 0u,
         "promotion-disabled receipt flag");

    must(rafaelia_learning_flush() == 0, "flush first run");
    must(rafaelia_learning_close() == 0, "close first run");

    must(rafaelia_learning_init(path, NULL) == 0, "reopen and replay");
    must(rafaelia_learning_set_mode(RAFAELIA_LEARNING_FROZEN) == 0, "freeze replayed model");

    uint32_t predicted = 0u;
    uint32_t support = 0u;
    uint16_t confidence = 0u;
    must(rafaelia_learning_predict(stable_context, &predicted, &confidence, &support) == 0,
         "predict after replay");
    must(predicted == 7u, "replayed prediction class");
    must(support == 1000u, "replayed predictor support");
    must(confidence == 65535u, "replayed predictor confidence");

    RafaeliaLearningSnapshotV1 replayed;
    must(rafaelia_learning_snapshot(&replayed) == 0, "snapshot replay");
    must(replayed.observations == 1000u, "replayed observations");
    must(replayed.records_committed == 1000u, "replayed committed records");
    must(rafaelia_learning_close() == 0, "close replayed store");

    corrupt_last_byte(path);

    must(rafaelia_learning_init(path, NULL) == 0,
         "corrupt tail is recovered to last complete verified record");
    RafaeliaLearningSnapshotV1 recovered;
    must(rafaelia_learning_snapshot(&recovered) == 0, "snapshot recovered store");
    must((recovered.flags & RAFAELIA_LEARNING_SNAPSHOT_RECOVERED_TAIL) != 0u,
         "recovered-tail flag set");
    must(recovered.records_committed == 999u,
         "bad final record excluded from verified committed prefix");
    must(rafaelia_learning_flush() == 0, "truncate recovered tail to verified prefix");
    must(rafaelia_learning_close() == 0, "close recovered store");

    must(unlink(path) == 0, "cleanup store");

    printf("RFL_SELFTEST_OK observations=1000 predictions=999 replay=PASS corrupt_tail=RECOVERED promotion=DISABLED\n");
    return 0;
}
