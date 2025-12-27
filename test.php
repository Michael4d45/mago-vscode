<?php

function test($x) {
    // Missing return type
    return $x * 2;
}

$unused = 42; // Unused variable

echo test(5);

