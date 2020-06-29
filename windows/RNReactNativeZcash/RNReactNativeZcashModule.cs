using ReactNative.Bridge;
using System;
using System.Collections.Generic;
using Windows.ApplicationModel.Core;
using Windows.UI.Core;

namespace React.Native.Zcash.RNReactNativeZcash
{
    /// <summary>
    /// A module that allows JS to share data.
    /// </summary>
    class RNReactNativeZcashModule : NativeModuleBase
    {
        /// <summary>
        /// Instantiates the <see cref="RNReactNativeZcashModule"/>.
        /// </summary>
        internal RNReactNativeZcashModule()
        {

        }

        /// <summary>
        /// The name of the native module.
        /// </summary>
        public override string Name
        {
            get
            {
                return "RNReactNativeZcash";
            }
        }
    }
}
